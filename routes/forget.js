const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");

/* ===== LINE CLIENT ===== */
const client = require("../config/line");


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

    /* ===== สุ่ม OTP ===== */
    const otp =
      Math.floor(
        100000 + Math.random() * 900000
      ).toString();

    /* ===== เก็บ OTP ===== */
    req.session.resetOTP = otp;
    req.session.resetPhone = phone;

    /* ===== ส่ง OTP เข้า LINE ===== */
    await client.pushMessage(
      user.line_user_id,
      {
        type: "text",
        text:
          `🔐 OTP รีเซ็ตรหัสผ่านของคุณคือ ${otp}`
      }
    );

    console.log("OTP SENT:", otp);

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

    /* ===== เช็ค OTP ===== */
    if (otp !== req.session.resetOTP) {

      return res.render("forgot-password", {
        step: 2,
        error: "OTP ไม่ถูกต้อง",
        success: null,
        phone: req.session.resetPhone
      });

    }

    /* ===== เช็ครหัสผ่าน ===== */
    const regex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{6,20}$/;

    if (!regex.test(password)) {

      return res.render("forgot-password", {
        step: 2,
        error:
          "รหัสผ่านต้องมี A-Z a-z และตัวเลข 6-20 ตัว",
        success: null,
        phone: req.session.resetPhone
      });

    }

    /* ===== เช็ครหัสตรงกัน ===== */
    if (password !== confirmPassword) {

      return res.render("forgot-password", {
        step: 2,
        error: "รหัสผ่านไม่ตรงกัน",
        success: null,
        phone: req.session.resetPhone
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
    req.session.resetOTP = null;
    req.session.resetPhone = null;

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