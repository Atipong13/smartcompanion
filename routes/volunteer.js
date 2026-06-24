const express = require("express");
const router = express.Router();
const db = require("../config/db");

/* ======================
   Middleware ตรวจสิทธิ์อาสา
====================== */
function isVolunteer(req,res,next){

  if(!req.session.user){
    return res.redirect("/login");
  }

  if(req.session.user.role !== "volunteer"){
    return res.redirect("/");
  }

  next();
}

/* ======================
   หน้าเคสรอรับ
====================== */
router.get("/", isVolunteer, async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT * FROM help_requests
      WHERE status='waiting'
      AND volunteer_id IS NULL
      ORDER BY id DESC
    `);

    res.render("volunteer", { data: rows || [] });

  } catch (err) {
    console.log(err);
    res.send("DB error");
  }

});

/* ======================
   รับเคส
====================== */
/* ======================
   รับเคส (ป้องกันรับซ้อน)
====================== */
router.post("/accept/:id", isVolunteer, async (req, res) => {

  try {

    const caseId = parseInt(req.params.id);
    const volunteerId = req.session.user.id;

    // ✅ ตรวจสอบว่าอาสามีเคสที่ยังเปิดอยู่หรือไม่
    const [activeCase] = await db.query(`
      SELECT id FROM help_requests
      WHERE volunteer_id=?
      AND status IN ('waiting', 'accepted')
      LIMIT 1
    `, [volunteerId]);

    if (activeCase.length > 0) {
      return res.status(400).json({
        success: false,
        message: "❌ คุณยังมีเคสที่ยังไม่จบ กรุณา <a href='/volunteer/mycase'>จบเคสเดิม</a> ก่อน"
      });
    }

    // ✅ รับเคส (ตรวจสอบ status + volunteer_id)
    const [result] = await db.query(`
      UPDATE help_requests
      SET volunteer_id=?,
          status='accepted'
      WHERE id=? 
      AND status='waiting'
      AND volunteer_id IS NULL
    `, [volunteerId, caseId]);

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "❌ เคสนี้มีคนรับแล้ว"
      });
    }

    res.redirect("/volunteer/mycase");

  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "❌ DB error"
    });
  }

});

/* ======================
   เคสของฉัน
====================== */
router.get("/mycase", isVolunteer, async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT * FROM help_requests
      WHERE volunteer_id=?
      AND status='accepted'
      ORDER BY id DESC
    `, [req.session.user.id]);

    res.render("mycase", { data: rows || [] });

  } catch (err) {
    console.log(err);
    res.send("DB error");
  }

});

/* ======================
   จบเคส
====================== */
router.post("/done/:id", isVolunteer, async (req, res) => {

  try {

    await db.query(`
      UPDATE help_requests
      SET status='completed',
          completed_at=NOW()
      WHERE id=?
      AND volunteer_id=?
    `, [req.params.id, req.session.user.id]);

    res.redirect("/volunteer/history");

  } catch (err) {
    console.log(err);
    res.send("DB error");
  }

});

/* ======================
   ประวัติ
====================== */
router.get("/history", isVolunteer, async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT hr.*, u.name AS elder_name
      FROM help_requests hr
      JOIN users u ON hr.elder_id = u.id
      WHERE hr.volunteer_id = ?
      AND hr.status = 'completed'
      ORDER BY hr.id DESC
    `, [req.session.user.id]);

    for (let row of rows) {
      const [messages] = await db.query(`
        SELECT m.*, u.name
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.request_id = ?
        ORDER BY m.created_at ASC
      `, [row.id]);

      row.messages = messages;
    }

    res.render("history", { data: rows });

  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาด");
  }
});
/* =========================
   EDIT PROFILE PAGE
========================= */
/* =========================
   EDIT PROFILE PAGE
========================= */
router.get("/edit-profile", isVolunteer, async (req, res) => {

  const volunteerId = req.session.user.id;

  const [rows] = await db.query(
    "SELECT * FROM users WHERE id=?",
    [volunteerId]
  );

  if (!rows.length) {
    return res.redirect("/login");
  }

  res.render("edit-profile", {
    user: rows[0],
    success: null,
    error: null
  });

});

/* =========================
   UPDATE PROFILE
========================= */const bcrypt = require("bcrypt");

router.post("/edit-profile", isVolunteer, async (req, res) => {

  const volunteerId = req.session.user.id;

  const {
    name,
    phone,
    age,
    area,
    experience,
    password
  } = req.body;

  const skills =
    req.body["skill[]"] || [];

  /* ======================
     ถ้ามีเปลี่ยนรหัสผ่าน
  ====================== */

  if(password && password.trim() !== ""){

    const hashed =
      await bcrypt.hash(password, 10);

    await db.query(
      `UPDATE users
       SET
         name=?,
         phone=?,
         age=?,
         area=?,
         skill=?,
         experience=?,
         password=?
       WHERE id=?`,
      [
        name,
        phone,
        age,
        area,
        skills.join(","),
        experience,
        hashed,
        volunteerId
      ]
    );

  } else {

    /* ===== ไม่เปลี่ยนรหัส ===== */

    await db.query(
      `UPDATE users
       SET
         name=?,
         phone=?,
         age=?,
         area=?,
         skill=?,
         experience=?
       WHERE id=?`,
      [
        name,
        phone,
        age,
        area,
        skills.join(","),
        experience,
        volunteerId
      ]
    );

  }

  const [rows] = await db.query(
    "SELECT * FROM users WHERE id=?",
    [volunteerId]
  );

  res.render("edit-profile", {
    user: rows[0],
    success: "✅ บันทึกข้อมูลสำเร็จ",
    error: null
  });

});
/* ======================
   เคสด่วน (จาก AI)
====================== */
router.get("/emergency-cases", isVolunteer, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM cases
      WHERE status='open'
      AND volunteer_id IS NULL
      ORDER BY id DESC
    `);

    res.render("emergency-cases", { data: rows || [] });

  } catch (err) {
    console.log(err);
    res.send("DB error");
  }
});
module.exports = router;