const Node = require('../models/Node');

// সফল কাজের জন্য ১ পয়েন্ট
exports.awardSuccessPoint = async (machineId, io) => {
    try {
        await Node.updateOne({ machineId }, { $inc: { points: 1 } });
        if (io) {
            io.to(machineId).emit('point_received', { 
                points: 1, type: 'SUCCESS', msg: 'Task Completed! +1 Point' 
            });
        }
    } catch (e) { console.error("Point Error:", e.message); }
};

// ১৫ মিনিটে ১৫ পয়েন্ট (আপটাইম বোনাস)
exports.initUptimePoints = (io, sendLog) => {
    setInterval(async () => {
        try {
            // 🔥 ফিক্স: যারা 'online' অথবা 'busy' (কাজ করছে), সবাই বোনাস পাবে
            const activeNodes = await Node.find({ 
                status: { $in: ['online', 'busy'] } 
            });

            if (activeNodes.length === 0) return;

            const nodeIds = activeNodes.map(n => n.machineId);
            
            // ডাটাবেসে পয়েন্ট যোগ করা
            await Node.updateMany(
                { machineId: { $in: nodeIds } }, 
                { $inc: { points: 1 } }
            );

            // ওয়ার্কারদের নোটিফিকেশন পাঠানো
            io.to('workers').emit('point_received', { 
                points: 1, 
                type: 'UPTIME',
                msg: '🎁 Bonus: +1 Point for staying active!' 
            });

            if (sendLog) sendLog('INFO', `💎 Bonus: Distributed 1 point to ${activeNodes.length} active workers.`);
            io.to('dashboard_room').emit('dashboard_update');
            
        } catch (e) {
            console.error("Uptime Point Error:", e.message);
        }
    }, 5 * 60 * 1000); // ৫ মিনিট পর পর
};