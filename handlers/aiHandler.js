const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const askAI = require("../utils/aiService");
const generateVoice = require("../utils/voiceService");
const { safePush } = require("../utils/safePush");

// Flex card แจ้งอาสา
const buildVolunteerAlert = (msg, aiReply, caseId) => ({
  type: "flex",
  altText: "พบเคสผู้สูงอายุ",
  contents: {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: "🚨 เคสด่วน", weight: "bold", size: "lg", color: "#ff0000" },
        { type: "text", text: msg, wrap: true, size: "sm" },
        {
          type: "text",
          text: "ระดับความเสี่ยง: " + aiReply.risk,
          weight: "bold",
          color: aiReply.risk === "emergency" ? "#ff0000" : "#ff9800"
        }
      ]
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [{
        type: "button", style: "primary", color: "#ff0000",
        action: { type: "postback", label: "✅ รับเคส", data: `accept_case_${caseId}` }
      }]
    }
  }
});

// แจ้งอาสาทุกคน + ขอพิกัด
const notifyVolunteers = async (msg, aiReply, userId) => {
  const [result] = await db.query(
    "INSERT INTO cases (message, risk, status, lat, lng, line_user_id) VALUES (?, ?, 'open', 0, 0, ?)",
    [msg, aiReply.risk, userId]
  );
  const caseId = result.insertId;

  await safePush(userId, {
    type: "text",
    text: "📍 กรุณาส่งตำแหน่งของคุณเพื่อให้อาสาได้รับการแจ้งเตือน",
    quickReply: { items: [{ type: "action", action: { type: "location", label: "📍 ส่งตำแหน่ง" } }] }
  });

  const [volunteers] = await db.query(
    "SELECT id, line_user_id FROM users WHERE role='volunteer' AND status='approved'"
  );
  for (const v of volunteers) {
    await safePush(v.line_user_id, buildVolunteerAlert(msg, aiReply, caseId));
    await new Promise(r => setTimeout(r, 300));
  }

  return caseId;
};

// ตอบกลับพร้อมเสียง
const replyWithVoice = async (client, event, aiReply, hasNotified) => {
  const filename = `ai_${Date.now()}`;              
  const voice = await generateVoice(aiReply.reply, filename); // ✅ รับเป็น object
  const audioUrl = `${process.env.BASE_URL}${voice.url}`;     // ✅ เอาแค่ .url

  return client.replyMessage(event.replyToken, [
    { 
      type: "audio", 
      originalContentUrl: audioUrl, 
      duration: voice.duration  
    },
    {
      type: "text",
      text: aiReply.reply,
      quickReply: {
        items: [hasNotified
          ? { type: "action", action: { type: "location", label: "📍 ส่งตำแหน่ง" } }
          : { type: "action", action: { type: "message", label: "❌ ออกจาก AI", text: "ออกจาก AI" } }
        ]
      }
    }
  ]);
};

// จัดการข้อความ text ใน AI mode
const handleAIText = async (event, user, client, msg) => {
  await db.query("UPDATE users SET ai_last_active=NOW() WHERE id=?", [user.id]);
  const aiReply = await askAI(msg);

  let notified = false;
  if (aiReply.notify_volunteer) {
    await notifyVolunteers(msg, aiReply, event.source.userId);
    notified = true;
  }

  return replyWithVoice(client, event, aiReply, notified);
};

// จัดการเสียงใน AI mode
const handleAIAudio = async (event, user, client) => {
  const { transcribeAudio } = require("../whisper");

  const stream = await client.getMessageContent(event.message.id);
  const filePath = path.join(process.cwd(), "public/audio", `${event.message.id}.m4a`);
  const writable = require("fs").createWriteStream(filePath);
  stream.pipe(writable);
  await new Promise((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("error", reject);
  });

  const text = await transcribeAudio(filePath);
  const aiReply = await askAI(text);

  let notified = false;
  if (aiReply.notify_volunteer) {
    await notifyVolunteers(text, aiReply, event.source.userId);
    notified = true;
  }

  return replyWithVoice(client, event, aiReply, notified);
};

module.exports = { handleAIText, handleAIAudio };