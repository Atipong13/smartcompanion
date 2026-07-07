const { execFile } = require("child_process");

function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    // ✅ ใช้ execFile แทน exec — argument ถูกส่งแยกจาก shell โดยตรง
    // ป้องกัน command injection แม้ filePath จะมีอักขระพิเศษปนมา
    execFile("python", ["whisper.py", filePath], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

module.exports = { transcribeAudio };