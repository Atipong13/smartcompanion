const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

// Rich Menu เดิม
const RICHMENU_ID = "richmenu-4c00a8ef07910382924ce46b4b1f2d77";
async function uploadImage() {
  try {
    const imagePath = path.join(__dirname, "images/history.png");

    if (!fs.existsSync(imagePath)) {
      console.log("❌ ไม่พบไฟล์:", imagePath);
      return;
    }

    const image = fs.readFileSync(imagePath);

    console.log("📸 Uploading image...");
    console.log("📊 Size:", image.length, "bytes");

    // ตรวจสอบ Rich Menu ก่อน
    await axios.get(
      `https://api.line.me/v2/bot/richmenu/${RICHMENU_ID}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    console.log("✅ Rich Menu พบ");

    // อัปโหลดรูปใหม่ทับของเดิม
    await axios.post(
      `https://api-data.line.me/v2/bot/richmenu/${RICHMENU_ID}/content`,
      image,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/png"
        },
        maxBodyLength: Infinity
      }
    );

    console.log("✅ อัปโหลดรูปสำเร็จ");

  } catch (err) {
    console.error("❌ Error");
    console.error("Status:", err.response?.status);
    console.error("Data:", err.response?.data || err.message);
  }
}

uploadImage();