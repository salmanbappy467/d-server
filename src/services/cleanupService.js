const Job = require('../models/Job');
const Node = require('../models/Node');

const runCleanup = async (io) => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000); // ১ ঘন্টা আগে
    const twoMinutesAgo = new Date(now - 2 * 60 * 1000); // ২ মিনিট আগে

    try {
        // 🔥 ধাপ ১: জম্বি ওয়ার্কার ফিক্স (Zombie Worker Fix)
        // যারা ২ মিনিট ধরে কোনো পিং দেয়নি কিন্তু 'online' বা 'busy' দেখাচ্ছে, 
        // তাদের জোর করে 'offline' করা হবে।
        const deadNodes = await Node.updateMany(
            { 
                status: { $in: ['online', 'busy'] },
                lastActive: { $lt: twoMinutesAgo }
            },
            { $set: { status: 'offline' } }
        );

        if (deadNodes.modifiedCount > 0) {
            console.log(`⚠️ Cleanup: Marked ${deadNodes.modifiedCount} dead workers as offline.`);
            // ড্যাশবোর্ডে আপডেট পাঠানো
            if(io) io.to('dashboard_room').emit('dashboard_update');
        }

        // 🔥 ধাপ ২: ১ ঘন্টার পুরনো জব ডিলিট করা (শুধুমাত্র কাজের হিস্ট্রি ডিলিট হবে)
        const jobResult = await Job.deleteMany({
            status: { $in: ['completed', 'failed'] },
            updatedAt: { $lt: oneHourAgo }
        });

        if (jobResult.deletedCount > 0) {
            console.log(`🧹 Cleanup: Deleted ${jobResult.deletedCount} old jobs.`);
        }

        // ❌ ধাপ ৩ (বাতিল): অফলাইন ওয়ার্কার ডিলিট করার কোডটি এখান থেকে সরিয়ে ফেলা হয়েছে।
        // এখন ওয়ার্কার অফলাইন হলেও ডাটাবেসে তার রেকর্ড আজীবন থেকে যাবে।

    } catch (e) {
        console.error("❌ Cleanup Error:", e.message);
    }
};

const startCleanupService = (io) => {
    setInterval(() => runCleanup(io), 60 * 1000);
    runCleanup(io);
};

module.exports = startCleanupService;