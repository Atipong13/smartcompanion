const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");

/* ===== LINE CLIENT ===== */
const client = require("../config/line");

/* =========================
   ส่ง OTP ใหม่
========================= */
/* =========================
   ส่ง OTP ใหม่
========================= */
async function sendNewOTP(phone, req) {

  // สุ่ม OTP 6 หลัก
  const otp = Math.floor(
    100000 + Math.random() * 900000
  ).toString();

  // เก็บ OTP ไว้ใน Session
  req.session.resetOTP = otp;
  req.session.resetPhone = phone;

  // หา LINE User
  const [rows] = await db.query(
    "SELECT line_user_id FROM users WHERE phone=?",
    [phone]
  );

  if (!rows.length || !rows[0].line_user_id) {
    throw new Error("ไม่พบ LINE User");
  }

  // ส่ง OTP เข้า LINE
  await client.pushMessage(rows[0].line_user_id, {
    type: "text",
    text:
`🔐 รีเซ็ตรหัสผ่าน

OTP ของคุณคือ

${otp}

หากกรอกผิด ระบบจะส่ง OTP ใหม่ให้อัตโนมัติ`
  });

  console.log("OTP :", otp);

  return otp;
}

router.get("/", (req, res) => {

  res.render("forgot-password", {
    step: 1,
    error: null,
    success: null,
    phone: null
  });

});

/* =========================
   ส่ง OTP
========================= */
router.post("/", async (req, res) => {

  try {

    const { phone } = req.body;

    /* ===== หา user ===== */
    const [rows] = await db.query(
      "SELECT * FROM users WHERE phone=?",
      [phone]
    );

    if (!rows.length) {

      return res.render("forgot-password", {
        step: 1,
        error: "ไม่พบเบอร์โทรศัพท์นี้",
        success: null,
        phone: null
      });

    }

    const user = rows[0];

    /* ===== เช็ค LINE ===== */
    if (!user.line_user_id) {

      return res.render("forgot-password", {
        step: 1,
        error: "บัญชีนี้ยังไม่ได้เชื่อม LINE",
        success: null,
        phone: null
      });

    }

/* ===== ส่ง OTP ===== */
await sendNewOTP(phone, req);

return res.render("forgot-password", {
  step: 2,
  error: null,
  success: "ส่ง OTP เข้า LINE แล้ว",
  phone
});

    //console.log("OTP SENT:", otp);

    /* ===== ไปหน้าใส่ OTP ===== */
    return res.render("forgot-password", {
      step: 2,
      error: null,
      success: "ส่ง OTP เข้า LINE แล้ว",
      phone
    });

  } catch (err) {

    console.error(
      "LINE PUSH ERROR:",
      err.response?.data || err
    );

    return res.render("forgot-password", {
      step: 1,
      error: "ส่ง OTP ไม่สำเร็จ",
      success: null,
      phone: null
    });

  }

});

/* =========================
   RESET PASSWORD
========================= */
router.post("/reset", async (req, res) => {

  try {

    const {
      otp,
      password,
      confirmPassword
    } = req.body;

    if (!req.session.resetOTP || !req.session.resetPhone) {

  return res.render("forgot-password",{
    step:1,
    error:"OTP หมดอายุ กรุณาขอ OTP ใหม่",
    success:null,
    phone:null
  });

}

    /* ===== เช็ค OTP ===== */
if (otp !== req.session.resetOTP) {

    await sendNewOTP(req.session.resetPhone, req);

    return res.render("forgot-password",{
        step:2,
        error:"OTP ไม่ถูกต้อง ระบบได้ส่ง OTP ใหม่แล้ว",
        success:null,
        phone:req.session.resetPhone
    });

}

    /* ===== เช็ครหัสผ่าน ===== */
   const regex =
/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8,20}$/;

if (!regex.test(password)) {

    await sendNewOTP(req.session.resetPhone, req);

    return res.render("forgot-password",{
        step:2,
        error:"รหัสผ่านต้องมี A-Z a-z ตัวเลข และยาว 8-20 ตัว ระบบได้ส่ง OTP ใหม่แล้ว",
        success:null,
        phone:req.session.resetPhone
    });

}

    /* ===== เช็ครหัสตรงกัน ===== */
if (password !== confirmPassword) {

    await sendNewOTP(req.session.resetPhone, req);

    return res.render("forgot-password",{
        step:2,
        error:"รหัสผ่านไม่ตรงกัน ระบบได้ส่ง OTP ใหม่แล้ว",
        success:null,
        phone:req.session.resetPhone
    });

}

    /* ===== HASH PASSWORD ===== */
    const hashed =
      await bcrypt.hash(password, 10);

    /* ===== UPDATE PASSWORD ===== */
    await db.query(
      "UPDATE users SET password=? WHERE phone=?",
      [
        hashed,
        req.session.resetPhone
      ]
    );

    /* ===== ล้าง session ===== */
delete req.session.resetOTP;
delete req.session.resetPhone;

    return res.render("forgot-password", {
      step: 1,
      error: null,
      success: "รีเซ็ตรหัสผ่านสำเร็จ",
      phone: null
    });

  } catch (err) {

    console.error(err);

    return res.render("forgot-password", {
      step: 1,
      error: "เกิดข้อผิดพลาด",
      success: null,
      phone: null
    });

  }

});

module.exports = router;