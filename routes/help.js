const express = require("express");
const router = express.Router();
const db = require("../config/db");
const line = require("@line/bot-sdk");
const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');
const { generateVoice } = require("../utils/tts");
const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
};

const client = new line.Client(config);


/* ================= SAFE PUSH ================= */

const safePush = async (to, message) => {
  if (!to) return;
  try {
    await client.pushMessage(to, message);
  } catch (err) {
    console.error("Push Error:", err.response?.data || err.message);
  }
};

/* ================= FLEX ขอโล ================= */

const locationFlex = (caseId) => ({
  type: "flex",
  altText: "ยืนยันส่งตำแหน่ง",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [{ type: "text", text: "กรุณายืนยันส่งตำแหน่งของท่านค่ะ 📍" }]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          action: { type: "uri", label: "📍 ส่งตำแหน่ง", uri: "line://nv/location" }
        },
        {
          type: "button",
          action: { type: "postback", label: "❌ ไม่ส่งตำแหน่ง", data: `no_location_${caseId}` }
        }
      ]
    }
  }
});

/* ================= FLEX จบเคส ================= */

const completeFlex = (caseId) => ({
  type: "flex",
  altText: "จบเคส",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "เมื่องานเสร็จเรียบร้อยแล้ว กรุณากดปุ่มด้านล่างเพื่อจบเคสค่ะ 🙏",
          wrap: true
        }
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          action: {
            type: "postback",
            label: "🏁 จบเคส",
            data: `complete_${caseId}`
          }
        }
      ]
    }
  }
});
const handleMessage = async (event, user) => {

  // ✅ เพิ่มการรับเสียง
  if (event.message.type === "audio") {
    return await handleAudio(event, user);
  }

  if (event.message.type === "location")
    return await handleLocation(event, user);

  if (!event.message.text) return null;

  const text = event.message.text.trim();
  /* ================= บล็อคเมนูสำหรับอาสา ================= */

  if (user.role === "volunteer") {

    const blockedMenus = [
      "ขอความช่วยเหลือ",
      "พูดคุยกับอาสา",
      "พูดคุยกับ AI"
    ];

    if (blockedMenus.includes(text)) {
      return {
        type: "text",
        text: "❌ สมัครอาสาไม่สามารถใช้เมนูนี้ได้"
      };
    }
  }

if (text === "ขอความช่วยเหลือ") {

    // ✅ ตรวจสอบว่ามีเคสที่ยังไม่จบ
    const [openCases] = await db.query(
      "SELECT id FROM help_requests WHERE elder_id=? AND status IN ('waiting', 'accepted') LIMIT 1",
      [user.id]
    );

    if (openCases.length > 0) {
      return {
        type: "text",
        text: "❌ คุณยังมีคำขอช่วยเหลือที่ยังไม่จบ\n📌 กรุณารอให้อาสาจบเคสเดิมก่อน"
      };
    }

    // ✅ สร้างเคสทันที (ตั้งเป็น urgent หรือ normal ตามที่คุณต้องการ)
    const [result] = await db.query(
      "INSERT INTO help_requests (elder_id, urgency, status, created_at) VALUES (?, ?, ?, NOW())",
      [user.id, "urgent", "waiting"]
    );

    // ✅ แจ้งอาสา
// ✅ แก้เป็น
await notifyVolunteers(result.insertId);
    // ✅ ตอบกลับผู้ใช้
    return {
      type: "text",
      text: "📩 ระบบส่งคำขอของคุณถึงอาสาแล้ว กรุณารอสักครู่ 🙏"
    };
  }

  /* ===== 1️⃣ ผู้สูงอายุ → อาสา ===== */

  const [activeElder] = await db.query(
    "SELECT * FROM help_requests WHERE elder_id=? AND status='accepted' ORDER BY id DESC LIMIT 1",
    [user.id]
  );
  if (activeElder.length) {
    /* ================= ตั้งกิจกรรม ================= */

    if (text === "ตั้งกิจกรรม") {

      const [rows] = await db.query(
        "SELECT * FROM reminders WHERE elder_id=? AND status='pending' ORDER BY reminder_time ASC",
        [user.id]
      );

      if (rows.length > 0) {
        return generateReminderListFlex(rows);
      }

      return activityTypeFlex;
    }

    const requestId = activeElder[0].id;

    // ✅ บันทึกข้อความลง DB
    await db.query(
      "INSERT INTO messages (request_id, sender_id, message) VALUES (?, ?, ?)",
      [requestId, user.id, text]
    );

    const [vol] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [activeElder[0].volunteer_id]
    );

    if (vol.length) {
      await safePush(vol[0].line_user_id, {
        type: "text",
        text: `💬 ข้อความจากผู้สูงอายุ:\n${text}`
      });
    }

    return { type: "text", text: "ส่งข้อความถึงอาสาเรียบร้อยแล้วค่ะ 🙏" };
  }

  /* ===== 2️⃣ อาสา → ผู้สูงอายุ ===== */
const [activeVolunteer] = await db.query(
  "SELECT * FROM help_requests WHERE volunteer_id=? AND status='accepted' ORDER BY id DESC LIMIT 1",
  [user.id]
);

if (activeVolunteer.length) {

  const requestId = activeVolunteer[0].id;

  await db.query(
    "INSERT INTO messages (request_id, sender_id, message) VALUES (?, ?, ?)",
    [requestId, user.id, text]
  );

  const [elder] = await db.query(
    "SELECT line_user_id FROM users WHERE id=?",
    [activeVolunteer[0].elder_id]
  );

  // ✅ 👇 ใส่ตรงนี้เลย
 if (elder.length) {

  const to = elder[0].line_user_id;

  // ✅ ส่งข้อความ
  await safePush(to, {
    type: "text",
    text: `💬 ข้อความจากอาสา:\n${text}`
  });

  try {
    // ✅ สร้างไฟล์เสียง
    const fileName = `voice_${Date.now()}.mp3`;
    const audioPath = await generateVoice(text, fileName);

    // ✅ URL จริงจาก ngrok
// ✅ แก้เป็น
const audioUrl = `${process.env.BASE_URL}${audioPath}`;
    await safePush(to, {
      type: "audio",
      originalContentUrl: audioUrl,
      duration: 5000
    });

  } catch (err) {
    console.error("TTS ERROR:", err);
  }
}

  return { type: "text", text: "ส่งข้อความถึงผู้สูงอายุเรียบร้อยแล้ว 🙏" };
}

return null;
  };

  /* ================= HANDLE AUDIO ================= */
const handleAudio = async (event, user) => {
  try {
    console.log("=== AUDIO START ===");
    console.log("user.id:", user.id);

    const [activeCase] = await db.query(
      "SELECT * FROM help_requests WHERE elder_id=? AND status='accepted' ORDER BY id DESC LIMIT 1",
      [user.id]
    );

    console.log("activeCase rows:", activeCase.length);
    if (activeCase.length) {
      console.log("caseId:", activeCase[0].id, "| volunteer_id:", activeCase[0].volunteer_id);
    }

    if (!activeCase.length) {
      return { type: "text", text: "❌ ยังไม่มีอาสารับเคสค่ะ 🙏" };
    }

    const requestId = activeCase[0].id;

    // 📥 ดึงไฟล์เสียงจาก LINE
    const stream = await client.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);
    console.log("audioBuffer size:", audioBuffer.length);

    if (audioBuffer.length === 0) {
      console.error("❌ audioBuffer ว่างเปล่า");
      return { type: "text", text: "❌ ไม่สามารถดึงไฟล์เสียงได้" };
    }

    // 💾 บันทึกไฟล์ลง disk
    const fileName = `audio_${Date.now()}.m4a`;
    const audioDir = path.join(process.cwd(), "public/audio");

    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const filePath = path.join(audioDir, fileName);
    fs.writeFileSync(filePath, audioBuffer);
    console.log("saved to:", filePath);

    // 🔗 URL สำหรับส่งให้ LINE
    const audioUrl = `${process.env.BASE_URL}/audio/${fileName}`;
    console.log("audioUrl:", audioUrl);

    // 📝 บันทึก DB
    await db.query(
      "INSERT INTO messages (request_id, sender_id, message, created_at) VALUES (?, ?, ?, NOW())",
      [requestId, user.id, `[เสียง 🎤] ${audioUrl}`]
    );

    // 📤 ส่งให้อาสา
    const [vol] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [activeCase[0].volunteer_id]
    );

    console.log("vol found:", vol.length, "| line_user_id:", vol[0]?.line_user_id);

    if (!vol.length || !vol[0].line_user_id) {
      console.error("❌ ไม่พบ line_user_id ของอาสา");
      return { type: "text", text: "❌ ไม่พบข้อมูลอาสา" };
    }

    // ✅ เช็ค URL เข้าถึงได้ก่อนส่ง
    const https = require("https");
    const urlCheck = await new Promise((resolve) => {
      https.get(audioUrl, (res) => {
        console.log("URL status:", res.statusCode);
        resolve(res.statusCode);
      }).on("error", (err) => {
        console.error("URL check error:", err.message);
        resolve(0);
      });
    });

    if (urlCheck !== 200) {
      console.error("❌ URL เข้าไม่ได้:", audioUrl);
      return { type: "text", text: "❌ ไฟล์เสียงเข้าถึงไม่ได้ กรุณาเช็ค BASE_URL" };
    }

    // ✅ ส่งข้อความแจ้งอาสา
    await safePush(vol[0].line_user_id, {
      type: "text",
      text: "🎤 ได้รับเสียงจากผู้สูงอายุ"
    });

    // ✅ ส่งไฟล์เสียงจริง
    await safePush(vol[0].line_user_id, {
      type: "audio",
      originalContentUrl: audioUrl,
      duration: 60000
    });

    console.log("=== AUDIO SENT OK ===");
    return { type: "text", text: "✅ ส่งเสียงถึงอาสาเรียบร้อยแล้ว 🎤" };

  } catch (err) {
    console.error("AUDIO ERROR:", err);
    return { type: "text", text: "❌ ส่งเสียงไม่สำเร็จ" };
  }
};
  /* ================= HANDLE POSTBACK ================= */

  const handlePostback = async (event, user) => {
    try {
      const data = event.postback.data;

      console.log("POSTBACK:", data); // debug
if (data.startsWith("accept_")) {
  const caseId = data.split("_")[1];

  if (!caseId) {
    return { type: "text", text: "❌ caseId ไม่ถูกต้อง" };
  }

  // เช็คว่ามีเคสค้างอยู่ไหม
  const [activeCase] = await db.query(`
    SELECT id FROM help_requests
    WHERE volunteer_id=?
    AND status IN ('waiting', 'accepted')
    LIMIT 1
  `, [user.id]);

  if (activeCase.length > 0) {
    return { type: "text", text: "❌ คุณยังมีเคสที่ยังไม่จบ กรุณาจบเคสเดิมก่อน" };
  }

  // เช็คว่าเคสนี้ยังไม่มีคนรับ
  const [result] = await db.query(`
    UPDATE help_requests
    SET status='accepted', volunteer_id=?
    WHERE id=? AND status='waiting' AND volunteer_id IS NULL
  `, [user.id, caseId]);

  if (result.affectedRows === 0) {
    return { type: "text", text: "❌ เคสนี้มีคนรับแล้ว" };
  }

  // ✅ ดึงข้อมูลเคส + ผู้สูงอายุ + อาสา พร้อมกัน
  const [caseData] = await db.query(`
    SELECT hr.detail,
           elder.name AS elder_name,
           elder.line_user_id AS elder_line_id,
           vol.name AS vol_name,
           vol.phone AS vol_phone
    FROM help_requests hr
    JOIN users elder ON hr.elder_id = elder.id
    JOIN users vol ON vol.id = ?
    WHERE hr.id=?
  `, [user.id, caseId]);

  if (!caseData.length) {
    return { type: "text", text: "❌ ไม่พบข้อมูลเคส" };
  }

  const c = caseData[0];

  // แจ้งผู้สูงอายุ
  if (c.elder_line_id) {
    await safePush(c.elder_line_id, {
      type: "flex",
      altText: "มีอาสารับเคสของคุณแล้ว",
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            { type: "text", text: "✅ มีอาสารับเคสของคุณแล้ว", weight: "bold", size: "lg", color: "#27ae60" },
            { type: "separator" },
            { type: "text", text: "👤 อาสา: " + (c.vol_name || "-"), size: "md" },
            { type: "text", text: "📞 โทร: " + (c.vol_phone || "-"), size: "md" },
            { type: "text", text: "💬 สามารถกดปุ่มด้านล่างเพื่อพูดคุยกับอาสาได้ทันที", size: "xs", color: "#888888", wrap: true, margin: "md" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#06C755",
              action: { type: "message", label: "💬 พูดคุยกับอาสา", text: "พูดคุยกับอาสา" }
            }
          ]
        }
      }
    });
  }

  // การ์ดให้อาสา
  return {
    type: "flex",
    altText: "คุณรับเคสนี้แล้ว",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "✅ คุณรับเคสนี้แล้ว", weight: "bold", size: "lg", color: "#27ae60" },
          { type: "separator" },
          { type: "text", text: "👤 ผู้สูงอายุ: " + (c.elder_name || "-"), size: "md" },
          { type: "text", text: "📝 เรื่อง: " + (c.detail || "-"), size: "sm", color: "#666666", wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            action: { type: "postback", label: "📍 ขอโลเคชั่น", data: `request_location_${caseId}` }
          },
          {
            type: "button",
            action: { type: "postback", label: "🏁 จบเคส", data: `complete_${caseId}` }
          }
        ]
      }
    }
  };
}
/* ================= ขอโลเคชั่น ================= */
if (data.startsWith("request_location_")) {

  // ✅ แก้ให้ชัดเจนขึ้น ป้องกัน caseId ผิด
  const caseId = data.replace("request_location_", "");
  console.log("request_location caseId:", caseId); // debug

  if (!caseId) {
    return { type: "text", text: "❌ caseId ไม่ถูกต้อง" };
  }

  const [caseData] = await db.query(
    "SELECT elder_id, latitude, longitude FROM help_requests WHERE id=?",
    [caseId]
  );

  console.log("caseData:", caseData); // debug ดูว่ามีข้อมูลไหม

  if (!caseData.length) {
    return { type: "text", text: "❌ ไม่พบข้อมูลเคส" };
  }

  const [elder] = await db.query(
    "SELECT line_user_id FROM users WHERE id=?",
    [caseData[0].elder_id]
  );

  console.log("elder:", elder); // debug

  if (!elder.length) {
    return { type: "text", text: "❌ ไม่พบข้อมูลผู้สูงอายุ" };
  }

  if (caseData[0].latitude && caseData[0].longitude) {
    return {
      type: "location",
      title: "📍 ตำแหน่งผู้สูงอายุ",
      address: "กดเพื่อนำทาง",
      latitude: caseData[0].latitude,
      longitude: caseData[0].longitude
    };
  }

  // ✅ ส่ง Quick Reply ให้ผู้สูงอายุ
  await safePush(elder[0].line_user_id, {
    type: "text",
    text: "📍 อาสาขอทราบตำแหน่งของคุณค่ะ กรุณากดปุ่มด้านล่าง",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "location",
            label: "📍 ส่งตำแหน่ง"
          }
        }
      ]
    }
  });

  return {
    type: "text",
    text: "📩 ส่งคำขอตำแหน่งให้ผู้สูงอายุแล้ว รอสักครู่..."
  };
}
      /* ================= จบเคส ================= */
     if (data.startsWith("complete_")) {
  const caseId = data.split("_")[1];

  if (!caseId) {
    return { type: "text", text: "❌ caseId ไม่ถูกต้อง" };
  }

  // ✅ เช็คว่าเคสนี้ยังเปิดอยู่ไหม
  const [check] = await db.query(
    "SELECT id, status FROM help_requests WHERE id=?",
    [caseId]
  );

  if (!check.length) {
    return { type: "text", text: "❌ ไม่พบเคสนี้" };
  }

  if (check[0].status === "completed") {
    return { type: "text", text: "⚠️ เคสนี้ถูกจบไปแล้ว" };
  }

  // ✅ จบเคส
  await db.query(
    "UPDATE help_requests SET status='completed', completed_at=NOW() WHERE id=?",
    [caseId]
  );

  const [caseData] = await db.query(
    "SELECT elder_id FROM help_requests WHERE id=?",
    [caseId]
  );

  if (caseData.length) {
    const [elder] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [caseData[0].elder_id]
    );

    if (elder.length) {
      await safePush(elder[0].line_user_id, {
        type: "text",
        text: "🎉 เคสเสร็จเรียบร้อย ขอบคุณที่ใช้บริการ 🙏"
      });
    }
  }

  return { type: "text", text: "✅ ปิดเคสเรียบร้อยแล้ว" };
}
      /* ================= เลือกประเภทกิจกรรม ================= */
      if (data.startsWith("act_")) {

        const type = data.replace("act_", "");

        return {
          type: "template",
          altText: "เลือกเวลา",
          template: {
            type: "buttons",
            text: "กรุณาเลือกวันเวลา",
            actions: [
              {
                type: "datetimepicker",
                label: "เลือกเวลา",
                data: `time_${type}`,
                mode: "datetime"
              }
            ]
          }
        };
      }

      /* ================= บันทึกเวลา ================= */
      if (data.startsWith("time_")) {

        const type = data.split("_")[1];
        const datetime = event.postback.params.datetime;

        const titleMap = {
          medicine: "💊 กินยา",
          exercise: "🏃 ออกกำลังกาย",
          other: "📝 กิจกรรมอื่น"
        };

        await db.query(
          "INSERT INTO reminders (elder_id, title, reminder_time, status) VALUES (?, ?, ?, 'pending')",
          [user.id, titleMap[type], datetime]
        );

        return {
          type: "text",
          text: `✅ ตั้งกิจกรรมแล้ว\n🕒 ${new Date(datetime).toLocaleString("th-TH")}`
        };
      }

      /* ================= ลบกิจกรรม ================= */
      if (data.startsWith("delete_")) {

        const reminderId = data.split("_")[1];

        await db.query(
          "DELETE FROM reminders WHERE id=? AND elder_id=?",
          [reminderId, user.id]
        );

        return {
          type: "text",
          text: "🗑 ลบกิจกรรมเรียบร้อยแล้ว"
        };
      }
      return null;

    } catch (err) {
      console.error("POSTBACK ERROR:", err);
      return { type: "text", text: "❌ เกิดข้อผิดพลาดในระบบ" };
    }

  } ;
  
  const handleEvent = async (event) => {

  const userId = event.source.userId;

  const [users] = await db.query(
    "SELECT * FROM users WHERE line_user_id=?",
    [userId]
  );

  if (!users.length) return;

  const user = users[0];

  if (event.type === "message") {
    return await handleMessage(event, user);
  }

  if (event.type === "postback") {
    return await handlePostback(event, user);
  }

  return null;
};

  /* ================= HANDLE LOCATION ================= */
const handleLocation = async (event, user) => {
  try {

    // 🔥 กัน event พัง
    if (!event?.message || event.message.type !== "location") {
      return { type: "text", text: "❌ ไม่ใช่ตำแหน่ง" };
    }

    const latitude = event.message.latitude;
    const longitude = event.message.longitude;

    // 🔥 หาเคสที่ active ล่าสุด
    const [caseData] = await db.query(
      "SELECT * FROM help_requests WHERE elder_id=? AND status='accepted' ORDER BY id DESC LIMIT 1",
      [user.id]
    );

    if (!caseData.length) {
      return { type: "text", text: "ยังไม่มีอาสารับเคสค่ะ 🙏" };
    }

    const caseId = caseData[0].id;

    // 🔥 บันทึกพิกัด
    await db.query(
      "UPDATE help_requests SET latitude=?, longitude=? WHERE id=?",
      [latitude, longitude, caseId]
    );

    // 🔥 หาอาสา
    const [vol] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [caseData[0].volunteer_id]
    );

    // 🔥 ส่งให้ volunteer
    if (vol.length) {
      await safePush(vol[0].line_user_id, {
        type: "location",
        title: "📍 ตำแหน่งผู้สูงอายุ",
        address: "คลิกดูในแผนที่",
        latitude,
        longitude
      });
    }

    return {
      type: "text",
      text: "📍 ส่งตำแหน่งเรียบร้อยแล้ว กำลังแจ้งอาสา 🙏"
    };

  } catch (err) {
    console.error("LOCATION ERROR:", err);
    return { type: "text", text: "❌ ส่งตำแหน่งไม่สำเร็จ" };
  }
};

  /* ================= แจ้งอาสา ================= */
const notifyVolunteers = async (caseId) => {

  const [vols] = await db.query(
    "SELECT line_user_id FROM users WHERE role='volunteer' AND status='approved'"
  );

  if (!vols.length) return;

  const flexMessage = {
    type: "flex",
    altText: "มีเคสใหม่เข้ามา",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "📢 มีเคสใหม่เข้ามา", weight: "bold", size: "lg" },
          { type: "text", text: `เลขเคส: #${caseId}`, size: "md", margin: "md" },
          { type: "text", text: "กรุณารับเคสหากท่านพร้อมช่วยเหลือ", size: "sm", margin: "md" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "postback",
              label: "✅ รับเคส",
              data: `accept_${caseId}`
            }
          }
        ]
      }
    }
  };

  // ✅ เปลี่ยนจาก for loop → multicast
  const userIds = vols.map(v => v.line_user_id);
  try {
    await client.multicast(userIds, flexMessage);
  } catch (err) {
    console.error("Multicast Error:", err.response?.data || err.message);
  }
};


  const generateReminderListFlex = (reminders) => ({
    type: "flex",
    altText: "รายการกิจกรรมที่ตั้งไว้",
    contents: {
      type: "carousel",
      contents: reminders.map(r => ({
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: r.title,
              weight: "bold",
              size: "lg"
            },
            {
              type: "text",
              text: `🕒 ${new Date(r.reminder_time).toLocaleString("th-TH")}`,
              size: "sm",
              margin: "md"
            }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#FF5555",
              action: {
                type: "postback",
                label: "❌ ลบกิจกรรม",
                data: `delete_${r.id}`
              }
            }
          ]
        }
      }))
    }
  });

  module.exports = { router, handleMessage, handlePostback };