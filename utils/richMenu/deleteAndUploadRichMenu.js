const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

// 🔥 เฉพาะอาสา
const VOLUNTEER_MENU_ID = "richmenu-469b972fa29fcd8f5402c54cb41b743b";

async function deleteAndUpload() {
  try {
    console.log("📌 Menu ID:", VOLUNTEER_MENU_ID);

    // ============ 0️⃣ ตรวจสอบไฟล์ ============
    const imagePath = path.join(__dirname, "images/history.png");
    console.log("📁 ตรวจสอบไฟล์:", imagePath);
    
    if (!fs.existsSync(imagePath)) {
      console.log("❌ ไฟล์ไม่พบ: ./images/history.png");
      console.log("📂 โปรดสร้าง images/history.png ก่อน");
      return;
    }
    console.log("✅ ไฟล์พบ\n");

    // ============ 1️⃣ ลบรูปเก่า ============
    console.log("🗑️  ลบรูปเก่า...");
    try {
      await axios.delete(
        `https://api.line.me/v2/bot/richmenu/${VOLUNTEER_MENU_ID}/image`,
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`
          }
        }
      );
      console.log("✅ ลบรูปเก่าสำเร็จ\n");
    } catch (delErr) {
      if (delErr.response?.status === 404) {
        console.log("⚠️  ไม่มีรูปเก่า ข้ามไป\n");
      } else {
        console.log("⚠️  Delete error:", delErr.response?.data?.message || delErr.message, "\n");
      }
    }

    // ============ 2️⃣ อัปโหลดรูปใหม่ ============
    console.log("📸 อัปโหลดรูปใหม่...");

    const image = fs.readFileSync(imagePath);
    console.log("📊 ขนาดไฟล์:", image.length, "bytes\n");

    await axios.post(
      `https://api.line.me/v2/bot/richmenu/${VOLUNTEER_MENU_ID}/image`,
      image,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "image/png",
          "Content-Length": image.length
        }
      }
    );

    console.log("✅ อัปโหลดเมนูอาสาสำเร็จแล้ว");

  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
    console.error("📌 Status:", err.response?.status);
    console.error("📌 URL ที่ใช้:", `https://api.line.me/v2/bot/richmenu/${VOLUNTEER_MENU_ID}/image`);
  }
}

deleteAndUpload();