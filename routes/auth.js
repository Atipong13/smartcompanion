const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcrypt");


/* =========================
   ROOT → LOGIN
========================= */
router.get("/", (req,res)=>{
  res.redirect("/login");
});

/* =========================
   LOGIN PAGE
========================= */
router.get("/login", (req, res) => {

  const error = req.session.error || null;
  const success = req.session.success || null;

  req.session.error = null;
  req.session.success = null;

  res.render("login", { error, success });

});
/* =========================
   LOGIN PAGE
========================= */
/* =========================
   LOGIN PROCESS
========================= */
router.post("/login", async (req, res) => {

  let { phone, password } = req.body;

  /* =========================
     INIT SESSION
  ========================= */
  if (!req.session.loginAttempts) {
    req.session.loginAttempts = 0;
  }

  /* =========================
     CHECK LOCK
  ========================= */
  if (req.session.lockUntil) {

    const now = Date.now();

    if (now < req.session.lockUntil) {

      const remain =
        Math.ceil((req.session.lockUntil - now) / 1000);

      req.session.error =
        `ล็อคชั่วคราว กรุณารอ ${remain} วินาที`;

      return res.redirect("/login");
    }

    // ครบเวลา → reset
    req.session.loginAttempts = 0;
    req.session.lockUntil = null;
  }

  /* =========================
     VALIDATE
  ========================= */
  if (!phone || !password) {

    req.session.error = "กรอกข้อมูลให้ครบ";
    return res.redirect("/login");
  }

  phone = phone.trim();
  password = password.trim();

  const phoneRegex = /^[0-9]{10}$/;

  if (!phoneRegex.test(phone)) {

    req.session.error =
      "เบอร์โทรต้องเป็นตัวเลข 10 หลัก";

    return res.redirect("/login");
  }

  try {

    const [result] = await db.query(
      "SELECT * FROM users WHERE phone=?",
      [phone]
    );

    /* =========================
       USER NOT FOUND
    ========================= */
    if (result.length === 0) {

      req.session.loginAttempts++;

      const remain =
        3 - req.session.loginAttempts;

      if (req.session.loginAttempts >= 3) {

        req.session.lockUntil =
          Date.now() + 60 * 1000;

        req.session.error =
          "ล็อคระบบ 1 นาที";
      } else {

        req.session.error =
          `เบอร์หรือรหัสผิด เหลือ ${remain} ครั้ง`;
      }

      return res.redirect("/login");
    }

    const user = result[0];

    let match = false;

    if (user.password.startsWith("$2b$")) {

      match =
        await bcrypt.compare(
          password,
          user.password
        );

    } else {

      match = password === user.password;
    }

    /* =========================
       PASSWORD WRONG
    ========================= */
    if (!match) {

      req.session.loginAttempts++;

      const remain =
        3 - req.session.loginAttempts;

      if (req.session.loginAttempts >= 3) {

        req.session.lockUntil =
          Date.now() + 60 * 1000;

        req.session.error =
          "ล็อคระบบ 1 นาที";

      } else {

        req.session.error =
          `เบอร์หรือรหัสผิด เหลือ ${remain} ครั้ง`;
      }

      return res.redirect("/login");
    }

    /* =========================
       RESET ATTEMPTS
    ========================= */
    req.session.loginAttempts = 0;
    req.session.lockUntil = null;

    /* =========================
       APPROVED CHECK
    ========================= */
    if (
      user.role === "volunteer" &&
      user.status !== "approved"
    ) {

      req.session.error = "ยังไม่อนุมัติ";
      return res.redirect("/login");
    }

    /* =========================
       LOGIN SUCCESS
    ========================= */
    req.session.user = user;
    req.session.user_id = user.id;
    req.session.role = user.role;

    console.log("LOGIN:", user.id, user.role);

    if (user.role === "admin")
      return res.redirect("/admin");

    if (user.role === "volunteer")
      return res.redirect("/volunteer");

    if (user.role === "elder")
      return res.redirect("/elder");

    return res.redirect("/login");

  } catch (error) {

    console.log("LOGIN ERROR:", error);

    req.session.error = "ระบบผิดพลาด";

    return res.redirect("/login");
  }

});



/* =========================
   LOGOUT
========================= */
router.get("/logout",(req,res)=>{
  req.session.destroy(()=>{
    res.redirect("/login");
  });
});
/* =========================
   VOLUNTEER REGISTER PAGE
========================= */
router.get("/volunteer/register", (req, res) => {
  const lineid = req.query.uid || null;
  const success = req.query.success ? "สมัครสำเร็จ รออนุมัติ" : null;

  const user = req.session.user || null;

  res.render("volunteer_register", {
    lineid,
    success,
    user
  });
});
/* =========================
   VOLUNTEER REGISTER PROCESS
========================= */
router.post("/volunteer/register", async (req, res) => {

const { name, phone, password, confirm, lineid, area, age, skill, experience } = req.body;
  if (!name || !phone || !password || !confirm || !lineid || !age) {
  return res.send("ข้อมูลไม่ครบ");
}
if (!area || !skill || !experience) {
  return res.send("ข้อมูลไม่ครบ");
}

  // ✅ ชื่อต้องเป็นภาษาไทยเท่านั้น
  const thaiNameRegex = /^[ก-๙\s]+$/;
  if (!thaiNameRegex.test(name)) {
    return res.send("กรุณากรอกชื่อเป็นภาษาไทยเท่านั้น");
  }

  // ✅ เบอร์โทร 10 หลัก ตัวเลขเท่านั้น
  const phoneRegex = /^[0-9]{10}$/;
  if (!phoneRegex.test(phone)) {
    return res.send("เบอร์โทรต้องเป็นตัวเลข 10 หลักเท่านั้น");
  }

  // ✅ อายุ ต้องเป็นตัวเลข 2 หลักเท่านั้น (10-99)
  const ageRegex = /^[0-9]{2}$/;
  if (!ageRegex.test(age)) {
    return res.send("อายุต้องเป็นตัวเลข 2 หลักเท่านั้น");
  }

  // ✅ รหัสผ่าน:
  // อย่างน้อย 8 ตัว
  // มีพิมพ์ใหญ่
  // มีพิมพ์เล็ก
  // มีตัวเลข
  // ห้ามมีอักษรไทย
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8,}$/;

  if (!passwordRegex.test(password)) {
    return res.send("รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมี A-Z a-z และตัวเลข ห้ามใช้ภาษาไทย");
  }

  // ✅ รหัสผ่านต้องตรงกัน
if (password !== confirm) {
  return res.send("รหัสผ่านไม่ตรงกัน");
}
const hash = await bcrypt.hash(password, 10);

// 🔥 แปลง skill ถ้าเลือกหลายอัน
const skills = Array.isArray(skill) ? skill.join(", ") : skill;
try {

  const skills = Array.isArray(skill) ? skill.join(", ") : skill;

  const [result] = await db.query(
    "SELECT * FROM users WHERE line_user_id=?",
    [lineid]
  );

  if (result.length > 0) {

    await db.query(`
      UPDATE users SET
        name=?,
        phone=?,
        password=?,
        area=?,
        age=?,
        skill=?,
        experience=?,
        role='volunteer',
        status='pending'
      WHERE line_user_id=?
    `,
    [name, phone, hash, area, age, skills, experience, lineid]
    );

    return res.redirect("/volunteer/register/?success=1&uid=" + lineid);

  } else {
    return res.send("ไม่พบข้อมูล LINE กรุณาสมัครผ่าน LINE ใหม่");
  }

} catch (err) {
  console.log("DB ERROR:", err);
  res.send("DB error");
}
});

module.exports = router;