const gTTS = require("gtts");
const path = require("path");

const generateVoice = (text, filename) => {
  return new Promise((resolve, reject) => {
    const gtts = new gTTS(text, "th");

    const filePath = path.join(__dirname, "../public/audio", filename);

    gtts.save(filePath, (err) => {
      if (err) reject(err);
      else resolve(`/audio/${filename}`);
    });
  });
};

module.exports = { generateVoice };