// src/models/Job.js
const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
    requestId: { type: String, required: true, unique: true },
    taskType: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['queued', 'processing', 'completed', 'failed'], 
        default: 'queued' 
    },
    priority: { type: Number, default: 0 }, // 0: Normal, 1: High (Login/Single)
    workerName: { type: String, default: null },
    payload: { type: Object }, 
    result: { type: Object, default: {} },
    
    // সময় ট্র্যাকিং
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date } 
}, { timestamps: true }); // updatedAt অটোমেটিক আপডেট হবে

// 🔥 ১ ঘন্টা (৩৬০০ সেকেন্ড) পর completedAt সময় অনুযায়ী অটো ডিলিট হবে
JobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('Job', JobSchema);