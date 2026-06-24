// utils/aiService.js
const axios = require("axios");

const askAI = async (message) => {
  try {
    const response = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "qwen2.5:3b",
        prompt: `
คุณคือ AI ผู้ช่วยดูแลสุขภาพผู้สูงอายุ มีความเชี่ยวชาญด้านการประเมินอาการเบื้องต้น

วิเคราะห์ข้อความต่อไปนี้และตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกจาก JSON

รูปแบบที่ต้องตอบ:
{
  "risk": "low|medium|high|emergency",
  "notify_volunteer": true|false,
  "symptoms": ["อาการที่พบ"],
  "body_part": "อวัยวะหรือระบบที่เกี่ยวข้อง",
  "possible_cause": "สาเหตุที่เป็นไปได้",
  "advice": "คำแนะนำเบื้องต้น",
  "reply": "ข้อความตอบกลับผู้สูงอายุ (ภาษาไทย สุภาพ ห่วงใย)"
}

เกณฑ์ระดับความเสี่ยง:
- low      = อาการเล็กน้อย เช่น ปวดหัวเล็กน้อย อ่อนเพลีย นอนไม่หลับ
- medium   = อาการปานกลาง เช่น ไข้สูง ปวดท้อง อาเจียน เวียนหัวมาก
- high     = อาการรุนแรง เช่น หกล้ม ปวดข้อมาก หายใจลำบาก กินยาผิด
- emergency = อาการฉุกเฉิน เช่น เจ็บหน้าอก หมดสติ ชัก อัมพาต หายใจไม่ออก

notify_volunteer = true เมื่อ risk = high หรือ emergency หรือมีอาการต่อไปนี้:
เจ็บหน้าอก, แน่นหน้าอก, หายใจไม่ออก, หมดสติ, ชัก, ปากเบี้ยว, พูดไม่ได้,
แขนขาอ่อนแรง, อัมพาต, เลือดออกมาก, ล้ม, หกล้ม, ตกบันได, เดินไม่ได้,
ลุกไม่ไหว, ไข้เกิน 39, อยากตาย, กินยาผิด, กินยาเกินขนาด, ช่วยด้วย, ฉุกเฉิน

กฎ: สำหรับผู้สูงอายุ ให้ประเมินความเสี่ยงสูงกว่าคนทั่วไป 1 ระดับ
ถ้าไม่แน่ใจ ให้ notify_volunteer = true

ข้อความจากผู้สูงอายุ:
"${message}"
`,
        stream: false,
        options: { temperature: 0.1, num_predict: 300 }
      }
    );

    const cleanText = response.data.response
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanText);

    return {
      risk:             parsed.risk             || "low",
      notify_volunteer: parsed.notify_volunteer ?? false,
      symptoms:         parsed.symptoms         || [],
      body_part:        parsed.body_part        || "-",
      possible_cause:   parsed.possible_cause   || "-",
      advice:           parsed.advice           || "-",
      reply:            parsed.reply            || "ขอบคุณที่แจ้งให้ทราบนะคะ"
    };

  } catch (err) {
    console.log("askAI error:", err.response?.data || err.message);
    return {
      risk: "low", notify_volunteer: false,
      symptoms: [], body_part: "-",
      possible_cause: "-", advice: "-",
      reply: "ขออภัยค่ะ ระบบ AI มีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง"
    };
  }
};

module.exports = askAI;