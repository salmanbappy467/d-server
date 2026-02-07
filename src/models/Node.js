const mongoose = require('mongoose');

const NodeSchema = new mongoose.Schema({
    machineId: { type: String, required: true, unique: true },
    apiKey: { type: String, required: true }, // secretKey এর বদলে apiKey
    socketId: { type: String }, 
    name: { type: String }, 
    workerName: { type: String, default: 'Unknown' },
    
    designation: { type: String, default: 'Worker' },
    office: { type: String, default: 'N/A' },
    mobile: { type: String, default: 'N/A' },
    pbs: { type: String, default: 'N/A' },
    
    config: { type: Object },

    points: { type: Number, default: 0 },

    status: { type: String, default: 'offline' },
    currentJob: { type: String, default: null },
    
    // 🔥 ফিক্স ১: সব জায়গায় 'lastActive' ব্যবহার হবে
    lastActive: { type: Date, default: Date.now }, 
    ipAddress: { type: String },
    
    // 🔥 ফিক্স ২: পারফরম্যান্স অবজেক্ট আকারে থাকবে
    performance: {
        success: { type: Number, default: 0 },
        failed: { type: Number, default: 0 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Node', NodeSchema);