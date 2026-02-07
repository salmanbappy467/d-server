const axios = require('axios');
const Node = require('../models/Node');
const { v4: uuidv4 } = require('uuid');

const userCache = new Map();

exports.verifyWorker = async (apiKey, machineId, ip) => {
    let userData = null;

    // ১. ক্যাশ চেক
    if (userCache.has(apiKey)) {
        userData = userCache.get(apiKey);
    } else {
        try {
            const baseUrl = process.env.PBSNET_WORKER_URL ? process.env.PBSNET_WORKER_URL.replace(/\/$/, "") : "https://pbsnet-admin.salmanbappy467.workers.dev"; 
            const workerUrl = `${baseUrl}/view`;
            
            console.log(`🔐 Auth Request: ${workerUrl} [Key: ${apiKey.substring(0,6)}...]`);
            
            const response = await axios.post(
                workerUrl,
                { target_user_key: apiKey },
                { 
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-admin-secret': process.env.PBSNET_ADMIN_SECRET 
                    },
                    timeout: 8000
                }
            );

            userData = response.data;
            if (typeof userData === 'string') {
                try { userData = JSON.parse(userData); } catch(e) {}
            }

            console.log("✅ Worker Response Found"); // লগ কমানো হয়েছে

            if (userData.error || userData.message === 'Access Denied') {
                console.error("❌ Auth Denied by PBSNet:", userData.error || userData.message);
                return null;
            }

            userCache.set(apiKey, userData);
            setTimeout(() => userCache.delete(apiKey), 600 * 1000);

        } catch (error) {
            console.error("❌ Auth Network Error:", error.message);
            return null;
        }
    }

    // ২. মেশিন আইডি লজিক
    let isNewMachine = false;
    if (!machineId) {
        const uniqueSuffix = uuidv4().split('-')[0].substring(0, 6).toUpperCase();
        machineId = `NODE-${uniqueSuffix}`;
        isNewMachine = true;
    }

    // ৩. ডাটাবেস আপডেট (ফিক্সড)
    let node = await Node.findOne({ machineId });
    if (!node) {
        node = new Node({ machineId });
        isNewMachine = true; 
    }

    const workerName = userData.full_name || userData.name || userData.username || 'Unknown User';
    const workerOffice = userData.office || userData.office_name || userData.pbs || 'N/A';
    
    node.name = workerName;
    node.designation = userData.designation || 'Worker';
    node.office = workerOffice;
    node.mobile = userData.mobile || 'N/A';
    node.pbs = userData.pbs || 'N/A';
    
    // 🔥 ফিক্স: secretKey -> apiKey (মডেলের সাথে মিল রেখে)
    node.apiKey = apiKey; 
    
    node.status = 'online';
    node.ipAddress = ip;
    
    // 🔥 ফিক্স: lastSeen -> lastActive (মডেলের সাথে মিল রেখে)
    node.lastActive = new Date(); 
    
    try {
        await node.save();
        return { node, isNewMachine };
    } catch (err) {
        console.error("❌ DB Save Error:", err.message); // এখন সেভ এরর কনসোলে দেখা যাবে
        return null;
    }
};