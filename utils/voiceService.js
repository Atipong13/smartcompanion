const gTTS = require("gtts");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { getAudioDurationInSeconds } = require("get-audio-duration");

const generateVoice = (text, filename) => {
  return new Promise(async (resolve, reject) => {
    try {
      const audioDir = path.join(process.cwd(), "public/audio");
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const baseName = filename.replace(/\.[^/.]+$/, "");
      const mp3Path = path.join(audioDir, `${baseName}.mp3`);
      const m4aPath = path.join(audioDir, `${baseName}.m4a`);

      //  สร้าง MP3
      const gtts = new gTTS(text, "th");
      await new Promise((res, rej) => {
        gtts.save(mp3Path, (err) => {
          if (err) return rej(err);
          if (!fs.existsSync(mp3Path)) return rej(new Error("MP3 not created"));
          res();
        });
      });

      //  แปลงเป็น M4A
      await new Promise((res, rej) => {
        ffmpeg(mp3Path)
          .toFormat("ipod")
          .audioCodec("aac")
          .audioBitrate("128k")
          .on("end", () => { fs.unlink(mp3Path, () => {}); res(); })
          .on("error", rej)
          .save(m4aPath);
      });

      //  วัด duration จริง
const durationSec = await getAudioDurationInSeconds(m4aPath);
const durationMs = Math.ceil(durationSec * 1000);

console.log("✅ สร้างเสียงสำเร็จ:", baseName, "| duration:", durationMs, "ms"); // ✅ เพิ่มตรงนี้

setTimeout(() => {
  fs.unlink(m4aPath, (err) => {
    if (err) console.error("❌ ลบไม่ได้:", err.message);
    else console.log("🗑 ลบไฟล์แล้ว:", baseName);
  });
}, 10000);

resolve({ url: `/audio/${baseName}.m4a`, duration: durationMs });

    } catch (err) {
      console.error("❌ GENERATE VOICE ERROR:", err);
      reject(err);
    }
  });
};

module.exports = generateVoice; 