// utils/voiceService.js
const gTTS = require("gtts");
const fs = require("fs");
const path = require("path");

const generateVoice = (text, filename) => {
  return new Promise((resolve, reject) => {
    try {
      const gtts = new gTTS(text, "th");
      const filePath = path.join(process.cwd(), "public/audio", filename);

      gtts.save(filePath, (err) => {
        if (err) {
          console.log("❌ TTS ERROR:", err);
          return reject(err);
        }
        if (!fs.existsSync(filePath)) {
          return reject(new Error("Audio file not created"));
        }
        resolve(`/audio/${filename}`);
      });
    } catch (err) {
      console.log("❌ GENERATE VOICE ERROR:", err);
      reject(err);
    }
  });
};

module.exports = generateVoice;