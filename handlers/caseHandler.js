const db = require("../config/db");
const { safePush } = require("../utils/safePush");

const handleCasePostback = async (event, user, client, userStates) => {
  const data = event.postback.data;
  const userId = event.source.userId;

  /* ================= รับเคส ================= */
  if (data.startsWith("accept_case_")) {
    const caseId = data.replace("accept_case_", "");

    const [activeCase] = await db.query(
      "SELECT id FROM cases WHERE volunteer_id=? AND status IN ('open', 'accepted')",
      [user.id]
    );
    if (activeCase.length > 0) {
      return { type: "text", text: "❌ คุณยังมีเคสที่ยังไม่จบ กรุณาจบเคสเดิมก่อน\n📌 กดปุ่ม 'จบเคส' เพื่อปิดเคสปัจจุบัน" };
    }

    const [caseData] = await db.query(
      "SELECT id, line_user_id, lat, lng, status, volunteer_id FROM cases WHERE id=?",
      [caseId]
    );
    if (!caseData.length) return { type: "text", text: "❌ ไม่พบเคสนี้" };
    if (caseData[0].status !== "open") return { type: "text", text: "❌ เคสนี้มีคนรับแล้ว" };
    if (caseData[0].volunteer_id) return { type: "text", text: "❌ เคสนี้มีอาสาคนอื่นรับไปแล้ว" };

    const [lockCase] = await db.query(
      `UPDATE cases SET status='accepted', volunteer_id=?
       WHERE id=? AND status='open' AND volunteer_id IS NULL`,
      [user.id, caseId]
    );
    if (lockCase.affectedRows === 0) {
      return { type: "text", text: "❌ มีอาสาคนอื่นรับเคสนี้แล้ว" };
    }

    const latNum = parseFloat(caseData[0].lat);
    const lngNum = parseFloat(caseData[0].lng);
    if (latNum && lngNum && !isNaN(latNum) && !isNaN(lngNum)) {
      await safePush(userId, {
        type: "location",
        title: "📍 ตำแหน่งผู้สูงอายุ",
        address: "ตำแหน่งล่าสุด",
        latitude: latNum,
        longitude: lngNum
      });
    }

    return {
      type: "flex",
      altText: "รับเคสแล้ว",
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical",
          contents: [
            { type: "text", text: "✅ รับเคสแล้ว", weight: "bold" },
            { type: "text", text: "กดปุ่มด้านล่างเพื่อติดต่อ", size: "sm" }
          ]
        },
        footer: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: [
            { type: "button", action: { type: "postback", label: "📍 ขอพิกัด", data: `get_location_${caseId}` } },
            { type: "button", style: "primary", action: { type: "postback", label: "💬 แชท", data: `chat_case_${caseId}` } },
            { type: "button", style: "primary", color: "#27ae60", action: { type: "postback", label: "✅ จบเคส", data: `finish_case_${caseId}` } }
          ]
        }
      }
    };
  }

  /* ================= ขอพิกัด ================= */
  if (data.startsWith("get_location_")) {
    const caseId = data.replace("get_location_", "");

    const [caseData] = await db.query(
      "SELECT id, line_user_id, lat, lng, volunteer_id FROM cases WHERE id=?",
      [caseId]
    );
    if (!caseData.length) return { type: "text", text: "❌ ไม่พบเคสนี้" };
    if (String(caseData[0].volunteer_id) !== String(user.id)) {
      return { type: "text", text: "❌ คุณไม่มีสิทธิ์ดูพิกัดของเคสนี้" };
    }

    const lat = parseFloat(caseData[0].lat);
    const lng = parseFloat(caseData[0].lng);

    if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
      return { type: "location", title: "📍 ตำแหน่งผู้สูงอายุ", address: "ตำแหน่งล่าสุด", latitude: lat, longitude: lng };
    }

    await safePush(caseData[0].line_user_id, {
      type: "text",
      text: "📍 อาสาขอทราบตำแหน่งของคุณ\nกรุณากดส่งตำแหน่งปัจจุบัน",
      quickReply: { items: [{ type: "action", action: { type: "location", label: "📍 ส่งตำแหน่ง" } }] }
    });
    return { type: "text", text: "📩 ส่งคำขอตำแหน่งไปยังผู้สูงอายุแล้ว" };
  }

  /* ================= เปิดแชท ================= */
  if (data.startsWith("chat_case_")) {
    const caseId = data.replace("chat_case_", "");

    const [caseData] = await db.query(
      "SELECT line_user_id, message FROM cases WHERE id=?",
      [caseId]
    );
    if (!caseData.length) return { type: "text", text: "❌ ไม่พบเคสนี้" };

    const elderLineId = caseData[0].line_user_id;

    // ✅ เพิ่ม: หา users.id ของผู้สูงอายุ (user.id ของอาสามีอยู่แล้วใน `user` object)
    const [elderUser] = await db.query(
      "SELECT id FROM users WHERE line_user_id=?",
      [elderLineId]
    );
    const elderDbId = elderUser.length ? elderUser[0].id : null;

    userStates[userId] = { mode: "case_chat", role: "volunteer", caseId, partnerId: elderLineId, dbUserId: user.id };
    userStates[elderLineId] = { mode: "case_chat", role: "elder", caseId, partnerId: userId, dbUserId: elderDbId };

    await safePush(elderLineId, {
      type: "text",
      text: "👋 อาสาได้เปิดแชทคุยกับคุณแล้วนะคะ พิมพ์ตอบได้เลยค่ะ\n(พิมพ์ \"ออกจากแชท\" เพื่อจบการสนทนา)"
    });

    return {
      type: "flex",
      altText: "เริ่มแชทกับผู้สูงอายุ",
      contents: {
        type: "bubble",
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "text", text: "💬 แชทกับผู้สูงอายุ", weight: "bold", size: "lg" },
            { type: "text", text: "เคสเดิม: " + caseData[0].message.substring(0, 50), size: "sm", color: "#666666", wrap: true },
            { type: "text", text: "พิมพ์ข้อความเพื่อส่งไปยังผู้สูงอายุ", size: "sm", color: "#999999", margin: "md" }
          ]
        },
        footer: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: [{ type: "button", style: "secondary", action: { type: "message", label: "❌ ออกจากแชท", text: "ออกจากแชท" } }]
        }
      }
    };
  }

  /* ================= จบเคส ================= */
  if (data.startsWith("finish_case_")) {
    const caseId = data.replace("finish_case_", "");

    const [caseData] = await db.query("SELECT line_user_id FROM cases WHERE id=?", [caseId]);
    if (!caseData.length) return { type: "text", text: "❌ ไม่พบเคสนี้" };

    const elderLineId = caseData[0].line_user_id;

    await db.query("UPDATE cases SET status='done' WHERE id=?", [caseId]);
    await client.pushMessage(elderLineId, {
      type: "text",
      text: "✅ อาสาได้จบเคสแล้ว\nขอบคุณที่ใช้บริการ SmartCompanion 👋"
    });

    delete userStates[userId];
    delete userStates[elderLineId];

    return { type: "text", text: "✅ จบเคสเรียบร้อย\n🙏 ขอบคุณที่ช่วยเหลือผู้สูงอายุ" };
  }

  return null;
};

module.exports = { handleCasePostback };