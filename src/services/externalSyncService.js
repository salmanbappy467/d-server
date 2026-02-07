const axios = require('axios');
const Node = require('../models/Node');

const SYNC_URL = "https://pbsnet-admin.salmanbappy467.workers.dev/update";
const ADMIN_SECRET = process.env.PBSNET_ADMIN_SECRET || "AdminSecret12345";
const SYNC_INTERVAL = 15 * 60 * 1000; // ১৫ মিনিট

const syncPointsToExternal = async () => {
    console.log("⏳ Starting Global Point Sync...");

    try {
        // 🔥 অ্যাগ্রিগেশন পাইপলাইন (খুবই গুরুত্বপূর্ণ)
        // এটি ডাটাবেসের সব নোড চেক করে 'apiKey' অনুযায়ী গ্রুপ করবে এবং পয়েন্ট যোগ (Sum) করবে।
        const report = await Node.aggregate([
            { 
                $group: { 
                    _id: "$apiKey", // API Key অনুযায়ী গ্রুপ
                    totalPoints: { $sum: "$points" }, // সব মেশিনের পয়েন্টের যোগফল
                    activeNodes: { $sum: 1 } // কয়টি মেশিন আছে
                } 
            }
        ]);

        if (report.length === 0) return;

        for (const worker of report) {
            const apiKey = worker._id;
            const points = worker.totalPoints; // এটিই সেই "Combined Point"

            if (!apiKey || apiKey === "unknown") continue;

            const payload = {
                target_user_key: apiKey,
                subclass: "pbsnet-d-server",
                data: {
                    point: points, // টোটাল পয়েন্ট আপডেট হবে
                    active_nodes: worker.activeNodes,
                    last_synced: new Date().toISOString()
                }
            };

            try {
                // PATCH মেথড ব্যবহার করে আপডেট
                await axios.patch(SYNC_URL, payload, {
                    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET }
                });
                console.log(`✅ Synced User: ${apiKey.slice(0,6)}... | Total Points: ${points}`);
            } catch (err) {
                console.error(`❌ Sync Failed for ${apiKey}:`, err.message);
            }
        }

    } catch (e) { console.error("Global Sync Error:", e.message); }
};

const startSyncService = () => {
    // সার্ভার চালু হওয়ার ১ মিনিট পর প্রথম সিঙ্ক হবে (যাতে সার্ভার স্টেবল হতে সময় পায়)
    setTimeout(syncPointsToExternal, 60 * 1000);
    // এরপর প্রতি ১৫ মিনিট পর পর
    setInterval(syncPointsToExternal, SYNC_INTERVAL);
};

module.exports = startSyncService;