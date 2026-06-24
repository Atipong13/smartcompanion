const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

// ✅ ใช้ของผู้สูงอายุ
const RICH_MENU_ID = "richmenu-c37c1c371afc665fea3d038be8fa98e1";

async function setDefault() {
  try {
    await axios.post(
      `https://api.line.me/v2/bot/user/all/richmenu/${RICH_MENU_ID}`,
      {},
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    console.log("✅ ตั้งค่า DEFAULT = ผู้สูงอายุ สำเร็จแล้ว");

  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
  }
}

setDefault();