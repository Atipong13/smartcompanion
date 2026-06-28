const gTTS = require("gtts");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { getAudioDurationInSeconds } = require("get-audio-duration");

const generateVoice = (text, filename) => {
  return new Promise(async (resolve, reject) => {
    try {
      const audioDir = path.join(__dirname, "../public/audio");
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const baseName = filename.replace(/\.[^/.]+$/, ""); // ตัด .mp3 / .m4a ออก
      const mp3Path = path.join(audioDir, `${baseName}.mp3`);
      const m4aPath = path.join(audioDir, `${baseName}.m4a`);

      // Step 1: สร้าง MP3 จาก gTTS
      const gtts = new gTTS(text, "th");
      await new Promise((res, rej) => {
        gtts.save(mp3Path, (err) => {
          if (err) return rej(err);
          if (!fs.existsSync(mp3Path)) return rej(new Error("MP3 not created"));
          res();
        });
      });

      // Step 2: แปลง MP3 → M4A (LINE รองรับแค่ M4A)
      await new Promise((res, rej) => {
        ffmpeg(mp3Path)
          .toFormat("ipod")
          .audioCodec("aac")
          .audioBitrate("128k")
          .on("end", () => {
            fs.unlink(mp3Path, () => {}); // ลบ mp3 ทิ้ง
            res();
          })
          .on("error", rej)
          .save(m4aPath);
      });

      // Step 3: วัด duration จริง
      const durationSec = await getAudioDurationInSeconds(m4aPath);
      const durationMs = Math.ceil(durationSec * 1000);

      resolve({ url: `/audio/${baseName}.m4a`, duration: durationMs });

    } catch (err) {
      console.error("❌ TTS ERROR:", err);
      reject(err);
    }
  });
};

module.exports = { generateVoice }; // ✅ export เหมือนเดิม ไม่ต้องแก้ activity.js