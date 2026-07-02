// บันทึกข้อความแชทของระบบเคส AI (cases) โดยเฉพาะ
// แยกตารางจาก messages ของระบบ help_requests ปกติเด็ดขาด กันไม่ให้ปนกัน

const db = require("../config/db");

/**
 * @param {number} caseId       - cases.id
 * @param {number} senderId     - users.id ของผู้ส่ง (ไม่ใช่ LINE userId)
 * @param {string} text         - เนื้อหาข้อความ / placeholder เช่น "[เสียง]"
 * @param {string} messageType  - 'text' | 'audio' | 'image' | 'location'
 */
async function logCaseMessage(caseId, senderId, text, messageType = "text") {
  if (!caseId || !senderId) {
    console.warn("[caseMessageLogger] skip: missing caseId/senderId", { caseId, senderId, text });
    return null;
  }

  try {
    const [result] = await db.query(
      "INSERT INTO case_messages (case_id, sender_id, message, message_type, created_at) VALUES (?, ?, ?, ?, NOW())",
      [caseId, senderId, text, messageType]
    );
    return result.insertId;
  } catch (err) {
    // ห้ามให้ error ตรงนี้ทำให้ safePush ที่ทำไปแล้วพัง แค่ log ไว้
    console.error("[caseMessageLogger] insert failed:", err.message, { caseId, senderId });
    return null;
  }
}

module.exports = { logCaseMessage };