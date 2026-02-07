const Job = require('../models/Job');
const Node = require('../models/Node');

// ১. ডিসপ্যাচ লজিক
exports.tryDispatch = async (io) => {
    try {
        const job = await Job.findOne({ status: 'queued' }).sort({ priority: -1, createdAt: 1 });
        if (!job) return;

        const sockets = await io.in('workers').fetchSockets();
        const idleWorkers = sockets.filter(s => s.data.status === 'idle');
        if (idleWorkers.length === 0) return;

        // লোড ব্যালেন্সিং
        idleWorkers.sort((a, b) => (a.data.lastWorkTime || 0) - (b.data.lastWorkTime || 0));
        const bestWorker = idleWorkers[0];

        const workerName = bestWorker.data.name || "Unknown Worker";
        const machineId = bestWorker.data.machineId;

        bestWorker.data.status = 'busy';
        await Node.updateOne({ machineId }, { currentJob: job.requestId, status: 'busy' });

        job.status = 'processing';
        job.workerName = workerName;
        job.assignedTo = machineId;
        job.startedAt = new Date();
        await job.save();

        bestWorker.emit('execute_task', {
            requestId: job.requestId,
            taskType: job.taskType,
            payload: job.payload
        });

        io.to('dashboard_room').emit('new_log', {
            time: new Date().toLocaleTimeString(),
            type: 'INFO',
            message: `🚀 Assigned Job ${job.requestId.slice(0,6)} to ${workerName}`
        });
        io.to('dashboard_room').emit('dashboard_update');

    } catch (e) {
        console.error("❌ Dispatch Error:", e.message);
    }
};

// 🔥 ২. টাস্ক কমপ্লিশন (ফিক্সড)
exports.handleTaskCompletion = async (io, socket, data) => {
    try {
        const { requestId, result } = data;
        const { machineId, name } = socket.data;
        const isSuccess = result && !result.error;

        // জব আপডেট
        const job = await Job.findOne({ requestId });
        if (job) {
            job.status = isSuccess ? 'completed' : 'failed';
            job.result = result;
            job.completedAt = new Date();
            await job.save();
        }

        // 🔥 নোড আপডেট: lastActive এবং Performance ঠিক করা হলো
        const updateDoc = {
            $set: { 
                status: 'online', 
                currentJob: null, 
                lastActive: new Date() // lastSeen এর বদলে lastActive
            },
            $inc: {}
        };

        if (isSuccess) {
            updateDoc.$inc['points'] = 1;
            updateDoc.$inc['performance.success'] = 1; // totalSuccess এর বদলে performance.success
        } else {
            updateDoc.$inc['performance.failed'] = 1; // totalFailed এর বদলে performance.failed
        }

        await Node.updateOne({ machineId }, updateDoc);

        socket.data.status = 'idle';
        socket.data.lastWorkTime = Date.now();

        const statusIcon = isSuccess ? '✅' : '❌';
        const msg = isSuccess 
            ? `Job ${requestId.slice(0,6)} Done by ${name}` 
            : `Job ${requestId.slice(0,6)} Failed: ${result.error}`;

        io.to('dashboard_room').emit('new_log', {
            time: new Date().toLocaleTimeString(),
            type: isSuccess ? 'SUCCESS' : 'ERROR',
            message: `${statusIcon} ${msg}`
        });

        io.to('dashboard_room').emit('dashboard_update');
        exports.tryDispatch(io);

    } catch (e) {
        console.error("Task Completion Error:", e.message);
    }
};

// ৩. স্টাক জব রিকভারি
exports.recoverStuckJobs = async (io) => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    try {
        const stuckJobs = await Job.find({ status: 'processing', updatedAt: { $lt: tenMinutesAgo } });
        if (stuckJobs.length > 0) {
            for (const job of stuckJobs) {
                job.status = 'queued';
                job.workerName = null;
                job.startedAt = null;
                await job.save();
                // স্টাক নোড ফ্রি করা
                if(job.assignedTo) {
                    await Node.updateOne({ machineId: job.assignedTo }, { currentJob: null, status: 'online' });
                }
            }
            io.to('dashboard_room').emit('new_log', { type: 'WARNING', message: `⚠️ Recovered ${stuckJobs.length} stuck jobs.` });
            io.to('dashboard_room').emit('dashboard_update');
            exports.tryDispatch(io);
        }
    } catch (error) { console.error("❌ Recovery Error:", error.message); }
};