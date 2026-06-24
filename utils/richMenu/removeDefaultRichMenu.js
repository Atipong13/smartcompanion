require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

async function removeDefault() {
  try {
    await axios.delete(
      "https://api.line.me/v2/bot/user/all/richmenu",
      {
        headers: { Authorization: `Bearer ${TOKEN}` }
      }
    );

    console.log("✅ ลบ Default rich menu แล้ว");
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

removeDefault();