const authService = require('../services/authService');
const queueService = require('../services/queueService'); 
const Node = require('../models/Node');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = (io) => {
    io.on('connection', async (socket) => {
        const { type } = socket.handshake.query;
        const authData = socket.handshake.auth;
        const ip = socket.handshake.address;

        // ড্যাশবোর্ড কানেকশন
        if (type === 'dashboard') {
            socket.join('dashboard_room');
            console.log("💻 Dashboard Connected");
            return;
        }

        // ওয়ার্কার কানেকশন
        try {
            const result = await authService.verifyWorker(authData.apiKey, authData.machineId, ip);
            
            if (!result) {
                socket.emit('auth_error', { message: "Invalid Profile / Auth Failed" });
                return socket.disconnect();
            }

            const { node, isNewMachine } = result;

            if (isNewMachine) {
                socket.emit('save_machine_id', { newMachineId: node.machineId });
            }

            socket.data.name = node.name;
            socket.data.machineId = node.machineId;
            socket.emit('server_ready_for_sync');
            socket.data.workerName = node.name;
            socket.data.status = 'idle';

            socket.join('workers');
            socket.join(node.machineId); 

            io.to('dashboard_room').emit('new_log', {
                time: new Date().toLocaleTimeString(),
                type: 'INFO',
                message: `🟢 Connected: ${node.name} (${node.machineId.slice(0,6)})`
            });
            io.to('dashboard_room').emit('dashboard_update');

            // --- ইভেন্ট লিসেনারস ---


            socket.on('disconnect', async () => {
                await Node.updateOne({ machineId: node.machineId }, { status: 'offline' });
                io.to('dashboard_room').emit('new_log', {
                    time: new Date().toLocaleTimeString(),
                    type: 'WARNING',
                    message: `🔴 Worker Offline: ${node.name}`
                });
                io.to('dashboard_room').emit('dashboard_update');
            });

            // 🔥 ফিক্স: পিং এর সময় স্ট্যাটাস ওভাররাইট না করা
            socket.on('worker_ping', async () => {
                // ১. শুধুমাত্র সময় আপডেট করব
                const updateQuery = { lastActive: new Date() };
                
                // ২. যদি নোডটি ভুল করে 'offline' হয়ে থাকে, তবেই তাকে 'online' করব
                // কিন্তু যদি সে 'busy' থাকে, তবে তার স্ট্যাটাস চেঞ্জ করব না
                const currentNode = await Node.findOne({ machineId: node.machineId });
                if (currentNode && currentNode.status === 'offline') {
                    updateQuery.status = 'online';
                }

                await Node.updateOne({ machineId: node.machineId }, updateQuery);
            });




            socket.on('task_completed', (data) => {
                if (queueService.handleTaskCompletion) {
                    queueService.handleTaskCompletion(io, socket, data);
                }
            });

            socket.on('request_script', (scriptName, callback) => {
                const fs = require('fs');
                const path = require('path');
                const scriptPath = path.join(__dirname, '../../scripts', scriptName);
                
                if (fs.existsSync(scriptPath)) {
                    const content = fs.readFileSync(scriptPath, 'utf8');
                    callback({ found: true, content });
                } else {
                    callback({ found: false });
                }
            });

            // 🔥 স্ক্রিপ্ট ম্যানিফেস্ট রিকোয়েস্ট হ্যান্ডলিং (নতুন যোগ করুন)
socket.on('get_scripts_manifest', () => {
    const scriptsDir = path.join(__dirname, '../../scripts');
    
    // ফোল্ডার না থাকলে খালি অ্যারে পাঠানো
    if (!fs.existsSync(scriptsDir)) {
        socket.emit('scripts_manifest', []);
        return;
    }

    // ফোল্ডারের সব .js ফাইল রিড করে হ্যাশ তৈরি করা
    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));
    const manifest = files.map(file => {
        const content = fs.readFileSync(path.join(scriptsDir, file));
        const hash = crypto.createHash('md5').update(content).digest('hex');
        return { name: file, hash };
    });
    
    socket.emit('scripts_manifest', manifest);
});


// 🔥 স্পেসিফিক ফাইল রিকোয়েস্ট হ্যান্ডলিং (সার্ভার সাইড ফিক্স)
socket.on('request_file', (fileName) => {
    const safeName = path.basename(fileName);
    const filePath = path.join(__dirname, '../../scripts', safeName);
    
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8'); 
        
        // ১. আপনার পুরানো Node.js স্ক্রিপ্ট (index.js) এর জন্য
        socket.emit('file_data', { fileName: safeName, content });
        
        // ২. আপনার ডেস্কটপ/পিসি অ্যাপ (worker.js) এর জন্য
        socket.emit('receive_file', { name: safeName, content });
        
    } else {
        console.log(`File not found: ${safeName}`);
    }
});

