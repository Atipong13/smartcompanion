const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

// 🔥 เมนูผู้สูงอายุ
const RICH_MENU_ID = "richmenu-c37c1c371afc665fea3d038be8fa98e1";

async function upload() {
  try {
    console.log("📌 Upload ELDER MENU:", RICH_MENU_ID);

    const image = fs.readFileSync("./images/elder.png");

    await axios.post(
      `https://api-data.line.me/v2/bot/richmenu/${RICH_MENU_ID}/content`,
      image,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/png",
          "Content-Length": image.length
        }
      }
    );

    console.log("✅ อัปโหลดเมนูผู้สูงอายุสำเร็จ");

  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
  }
}

upload();