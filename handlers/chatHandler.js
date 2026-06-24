// handlers/chatHandler.js
const fs = require("fs");
const path = require("path");
const { safePush } = require("../utils/safePush");
const generateVoice = require("../utils/voiceService");

const handleCaseChat = async (event, userId, userStates, client) => {
  const state = userStates[userId];

  /* ===== ออกจากแชท ===== */
  if (event.message?.type === "text" && event.message.text.trim() === "ออกจากแชท") {
    const partnerId = state.partnerId;
    delete userStates[userId];
    delete userStates[partnerId];
    await safePush(partnerId, { type: "text", text: "👋 อีกฝ่ายออกจากแชทแล้ว" });
    return { type: "text", text: "✅ ออกจากแชทแล้ว" };
  }

  /* ===== TEXT ===== */
  if (event.message?.type === "text") {
    if (state.role === "volunteer") {
      const fileName = `tts_${Date.now()}.mp3`;
      const audioPath = await generateVoice(event.message.text, fileName);
      const audioUrl = `${process.env.BASE_URL}${audioPath}`;

      await safePush(state.partnerId, [
        { type: "text", text: "👨‍⚕️ อาสา\n" + event.message.text },
        { type: "audio", originalContentUrl: audioUrl, duration: 5000 }
      ]);
      return { type: "text", text: "✅ ส่งข้อความและเสียงแล้ว" };
    }

    await safePush(state.partnerId, { type: "text", text: "👵 ผู้สูงอายุ\n" + event.message.text });
    return { type: "text", text: "✅ ส่งข้อความแล้ว" };
  }

  /* ===== AUDIO ===== */
  if (event.message?.type === "audio") {
    const stream = await client.getMessageContent(event.message.id);
    const fileName = `${event.message.id}.m4a`;
    const filePath = path.join(process.cwd(), "public/audio", fileName);
    const writable = fs.createWriteStream(filePath);
    stream.pipe(writable);
    await new Promise((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });

    await safePush(state.partnerId, {
      type: "audio",
      originalContentUrl: `${process.env.BASE_URL}/audio/${fileName}`,
      duration: event.message.duration || 10000
    });
    return { type: "text", text: "✅ ส่งเสียงแล้ว" };
  }

  /* ===== IMAGE ===== */
  if (event.message?.type === "image") {
    await safePush(state.partnerId, {
      type: "image",
      originalContentUrl: `${process.env.BASE_URL}/proxy/${event.message.id}`,
      previewImageUrl: `${process.env.BASE_URL}/proxy/${event.message.id}`
    });
    return { type: "text", text: "✅ ส่งรูปแล้ว" };
  }

  /* ===== LOCATION ===== */
  if (event.message?.type === "location") {
    const { latitude: lat, longitude: lng } = event.message;
    await safePush(state.partnerId, {
      type: "flex",
      altText: "ตำแหน่ง",
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical",
          contents: [{
            type: "text",
            text: state.role === "elder" ? "📍 ผู้สูงอายุส่งตำแหน่ง" : "📍 อาสาส่งตำแหน่ง",
            weight: "bold", size: "lg"
          }]
        },
        footer: {
          type: "box", layout: "vertical",
          contents: [{
            type: "button", style: "primary",
            action: { type: "uri", label: "🗺 เปิด Google Maps", uri: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` }
          }]
        }
      }
    });
    return { type: "text", text: "✅ ส่งตำแหน่งแล้ว" };
  }

  return null;
};

module.exports = { handleCaseChat };