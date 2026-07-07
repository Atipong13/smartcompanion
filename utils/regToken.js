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
  if (!token || typeof token !== "string") return false;
  const [expStr, hmac] = token.split(".");
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;

  const payload = `${lineid}.${exp}`;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
}

module.exports = { sign, verify };