require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

async function deleteDefault() {
  try {
    await axios.delete(
      "https://api.line.me/v2/bot/user/all/richmenu",
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    console.log("✅ ลบ Default Rich Menu สำเร็จแล้ว");
  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
  }
}

deleteDefault();