const { exec } = require("child_process");

function transcribeAudio(filePath) {
  return new Promise((resolve, reject) => {
    exec(`python whisper.py "${filePath}"`, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

module.exports = { transcribeAudio };