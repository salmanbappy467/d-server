const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const SCRIPTS_DIR = path.join(__dirname, '../../scripts');

exports.syncWithGithub = async () => {
    try {
        let repoUrl = process.env.GITHUB_REPO_URL;
        if (!repoUrl) throw new Error("GITHUB_REPO_URL not found in .env");

        // ট্রেলিং স্ল্যাশ থাকলে রিমুভ করা
        if (repoUrl.endsWith('/')) repoUrl = repoUrl.slice(0, -1);

        // মেইন ব্রাঞ্চের জিপ লিংক
        const zipUrl = `${repoUrl}/archive/refs/heads/main.zip`;
        console.log(`📥 Syncing from GitHub: ${zipUrl}`);

        const response = await axios({
            method: 'get',
            url: zipUrl,
            responseType: 'arraybuffer'
        });

        // ফোল্ডার ক্লিনআপ
        if (fs.existsSync(SCRIPTS_DIR)) {
            try {
                fs.rmSync(SCRIPTS_DIR, { recursive: true, force: true });
            } catch (e) {
                console.log("⚠️ Could not delete folder strictly, trying simple unlink...");
            }
        }
        if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);

        const zip = new AdmZip(Buffer.from(response.data));
        const zipEntries = zip.getEntries();
        let fileCount = 0;

        zipEntries.forEach(entry => {
            if (entry.isDirectory) return;

            const fullPath = entry.entryName; // যেমন: MeterNet-main/scripts/logic.js
            const pathParts = fullPath.split('/');

            // "scripts" ফোল্ডারটি পাথের যেকোনো জায়গায় থাকতে পারে, তাই indexOF ব্যবহার করা হলো
            const scriptIndex = pathParts.indexOf('scripts');

            // যদি 'scripts' ফোল্ডার পাওয়া যায় এবং তার পরে কোনো ফাইল থাকে
            if (scriptIndex !== -1 && scriptIndex < pathParts.length - 1) {
                
                // scripts এর পরের অংশটুকু ফাইলের নাম হিসেবে নেওয়া হবে
                const fileName = pathParts.slice(scriptIndex + 1).join('/');
                const targetPath = path.join(SCRIPTS_DIR, fileName);
                const targetDir = path.dirname(targetPath);

                // সাব-ফোল্ডার থাকলে তৈরি করা
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

                fs.writeFileSync(targetPath, entry.getData());
                fileCount++;
                console.log(`✅ Updated: ${fileName}`);
            }
        });

        if (fileCount === 0) throw new Error("No files found inside 'scripts' folder in GitHub repo.");

        return { success: true, message: `Updated ${fileCount} files successfully.` };
    } catch (error) {
        console.error("❌ Sync Error:", error.message);
        throw error;
    }
};