require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require("socket.io");
const { v4: uuidv4 } = require('uuid');

const connectDB = require('./src/config/db');
const socketHandler = require('./src/sockets/socketHandler');
const queueService = require('./src/services/queueService');
const pointService = require('./src/services/pointService');
const Job = require('./src/models/Job'); 
const Node = require('./src/models/Node');
const githubService = require('./src/services/githubService');
const startSyncService = require('./src/services/externalSyncService'); 
const startCleanupService = require('./src/services/cleanupService'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ডাটাবেস এবং বুট ক্লিনআপ
connectDB().then(async () => {
    try {
        console.log("🧹 Running Boot Cleanup...");
        await Node.updateMany({ status: 'online' }, { $set: { status: 'offline', currentJob: null } });
        console.log(`✅ Boot Cleanup Complete.`);
    } catch (err) { console.error("❌ Boot Cleanup Failed:", err.message); }
});

app.use(cors());
app.use(express.json());
app.use(cookieParser());

const sendLog = (type, message) => {
    io.to('dashboard_room').emit('new_log', {
        time: new Date().toLocaleTimeString(),
        type: type,
        message: message
    });
};

socketHandler(io);
setInterval(() => { queueService.recoverStuckJobs(io); }, 60 * 1000); 
pointService.initUptimePoints(io, sendLog);
startSyncService(); 
startCleanupService(io);

// 🔥 ড্যাশবোর্ড অটো-হার্টবিট (প্রতি ৫ সেকেন্ডে)
setInterval(() => {
    io.to('dashboard_room').emit('dashboard_update');
}, 5000);

// Auth & Security
app.post('/api/admin/login', (req, res) => {
    if (req.body.password === (process.env.DASHBOARD_PASSWORD || "admin123")) {
        res.cookie('admin_access', 'true', { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
        res.json({ success: true });
    } else res.status(401).json({ success: false });
});

const protectPublicHtml = (req, res, next) => {
    if (req.path.endsWith('.html') && req.path !== '/index.html' && req.cookies.admin_access !== 'true') {
        return res.redirect('/public/index.html');
    }
    next();
};
app.use('/public', protectPublicHtml, express.static(path.join(__dirname, 'public')));

// 📊 Dashboard Data API (আপডেটেড)
app.get('/api/dashboard-data', async (req, res) => {
    try {
        const stats = {
            queued: await Job.countDocuments({ status: 'queued' }),
            completed: await Job.countDocuments({ status: 'completed' }),
            failed: await Job.countDocuments({ status: 'failed' })
        };
        
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        
        // 🔥 ফিক্স: ড্যাশবোর্ডে দেখানোর জন্য শুধু 'online' বা 'busy' ওয়ার্কার আনা হবে
        // অফলাইন ওয়ার্কার ডাটাবেসে থাকবে কিন্তু এখানে লোড হবে না
        const nodes = await Node.find({ 
            status: { $in: ['online', 'busy'] } 
        });
        
        const onlineNodeCount = nodes.filter(n => n.lastActive > oneMinuteAgo).length;
        
        res.json({ stats, nodes, onlineNodeCount });
    } catch(e) { res.status(500).json({error: e.message}) }
});

// Other APIs
app.post('/api/admin/sync-github', async (req, res) => {
    try {
        if (req.cookies.admin_access !== 'true') return res.status(401).send("Unauthorized");
        const result = await githubService.syncWithGithub();
        sendLog('SUCCESS', `✅ GitHub Sync: ${result.message}`);
        io.to('dashboard_room').emit('dashboard_update');
        io.to('workers').emit('server_ready_for_sync'); 
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/pages', (req, res) => {
    try {
        const files = fs.readdirSync(path.join(__dirname, 'public')).filter(f => f.endsWith('.html') && f !== 'index.html');
        res.json(files.map(f => ({ name: f.replace('.html', '').toUpperCase(), url: `/public/${f}` })));
    } catch (e) { res.json([]); }
});

app.post('/api/admin/clear-history', async (req, res) => {
    await Job.deleteMany({ status: { $in: ['completed', 'failed'] } });
    sendLog('WARNING', `⚠️ History Cleared`);
    io.to('dashboard_room').emit('dashboard_update');
    res.json({ success: true });
});

app.get('/api/status/:id', async (req, res) => {
    try {
        const job = await Job.findOne({ requestId: req.params.id });
        if (!job) return res.status(404).json({ error: "Job Not Found" });
        res.json(job);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/app/:scriptName', async (req, res) => {
    const sName = req.params.scriptName.endsWith('.js') ? req.params.scriptName : `${req.params.scriptName}.js`;
    if (!fs.existsSync(path.join(__dirname, 'scripts', sName))) return res.status(404).json({ error: "Script not found" });

    const requestId = uuidv4();
    await new Job({ requestId, taskType: sName, payload: req.body, priority: req.body.priority || 0 }).save();
    sendLog('INFO', `🆕 API Call via /app/${sName}`);
    queueService.tryDispatch(io);
    res.json({ status: "queued", trackingId: requestId });
});

server.listen(process.env.PORT || 8000, () => console.log(`🚀 MeterNet running on port ${process.env.PORT || 8000}`));