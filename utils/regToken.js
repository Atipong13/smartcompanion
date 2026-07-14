const crypto = require("crypto");

const SECRET = process.env.REG_TOKEN_SECRET || "change-this-in-env";
const EXPIRE_MS = 15 * 60 * 1000; // ลิงก์ใช้ได้ 15 นาที

// สร้าง token ผูกกับ lineid + เวลาหมดอายุ
function sign(lineid) {
  const exp = Date.now() + EXPIRE_MS;
  const payload = `${lineid}.${exp}`;
  const hmac = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${exp}.${hmac}`;
}

// ตรวจว่า token ตรงกับ lineid นี้จริง และยังไม่หมดอายุ
function verify(lineid, token) {
  try {
    if (!token || typeof token !== "string") return false;

    const [expStr, hmac] = token.split(".");
    if (!expStr || !hmac) return false;

    const exp = Number(expStr);
    if (!exp || Date.now() > exp) return false;

    const payload = `${lineid}.${exp}`;
    const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

    const hmacBuf = Buffer.from(hmac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    // ✅ ป้องกัน error ตอนความยาว buffer ไม่เท่ากัน
    if (hmacBuf.length !== expectedBuf.length) return false;

    return crypto.timingSafeEqual(hmacBuf, expectedBuf);
  } catch (err) {
    console.error("❌ regToken verify error:", err.message);
    return false;
  }
}

module.exports = { sign, verify };