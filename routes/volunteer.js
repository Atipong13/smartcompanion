const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { safePush } = require("../utils/safePush");
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
      SELECT hr.*, u.name AS elder_name
      FROM help_requests hr
      JOIN users u ON hr.elder_id = u.id
      WHERE hr.status='waiting'
      AND hr.volunteer_id IS NULL
      ORDER BY hr.id DESC
    `);

    res.render("volunteer", { data: rows || [] });

  } catch (err) {
    console.log(err);
    res.send("DB error");
  }
});

/* ======================
   รับเคส (ป้องกันรับซ้อน)
====================== */
router.post("/accept/:id", isVolunteer, async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);
    const volunteerId = req.session.user.id;

    // เช็คว่ามีเคสค้างอยู่ไหม
    const [activeCase] = await db.query(`
      SELECT id FROM help_requests
      WHERE volunteer_id=?
      AND status IN ('waiting', 'accepted')
      LIMIT 1
    `, [volunteerId]);

    if (activeCase.length > 0) {
      return res.status(400).json({
        success: false,
        message: "❌ คุณยังมีเคสที่ยังไม่จบ กรุณาจบเคสเดิมก่อน"
      });
    }

    // รับเคส
    const [result] = await db.query(`
      UPDATE help_requests
      SET volunteer_id=?, status='accepted'
      WHERE id=? AND status='waiting' AND volunteer_id IS NULL
    `, [volunteerId, caseId]);

    if (result.affectedRows === 0) {
      return res.status(400).json({ success: false, message: "❌ เคสนี้มีคนรับแล้ว" });
    }

    // ดึงข้อมูลเคส + ผู้สูงอายุ + อาสา
    const [cases] = await db.query(`
      SELECT hr.*, 
             elder.line_user_id AS elder_line_id,
             elder.name AS elder_name,
             vol.name AS vol_name,
             vol.phone AS vol_phone,
             vol.line_user_id AS vol_line_id
      FROM help_requests hr
      JOIN users elder ON hr.elder_id = elder.id
      JOIN users vol   ON vol.id = ?
      WHERE hr.id = ?
    `, [volunteerId, caseId]);

    const c = cases[0];

    // แจ้งผู้สูงอายุในไลน์
    if (c?.elder_line_id) {
      await safePush(c.elder_line_id, {
        type: "flex",
        altText: "มีอาสารับเคสของคุณแล้ว",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "✅ มีอาสารับเคสของคุณแล้ว", weight: "bold", size: "lg", color: "#27ae60" },
              { type: "separator" },
              { type: "text", text: "👤 อาสา: " + (c.vol_name || "-"), size: "md" },
              { type: "text", text: "📞 โทร: " + (c.vol_phone || "-"), size: "md" },
              { type: "text", text: "💬 สามารถกดปุ่มด้านล่างเพื่อพูดคุยกับอาสาได้ทันที", size: "xs", color: "#888888", wrap: true, margin: "md" }

            ]
          }
        }
      });
    }

    // แจ้งอาสาในไลน์ พร้อมปุ่มจัดการเคส
    if (c?.vol_line_id) {
      await safePush(c.vol_line_id, {
        type: "flex",
        altText: "คุณรับเคสนี้แล้ว",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              { type: "text", text: "✅ คุณรับเคสนี้แล้ว", weight: "bold", size: "lg", color: "#27ae60" },
              { type: "separator" },
              { type: "text", text: "👤 ผู้สูงอายุ: " + (c.elder_name || "-"), size: "md" },
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                action: { type: "postback", label: "📍 ขอโลเคชั่น", data: `request_location_${caseId}` }
              },
              {
                type: "button",
                action: { type: "postback", label: "🏁 จบเคส", data: `complete_${caseId}` }
              }
            ]
          }
        }
      });
    }

    res.redirect("/volunteer/mycase");

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "❌ DB error" });
  }
});

/* ======================
   เคสของฉัน
====================== */
router.get("/mycase", isVolunteer, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT hr.*, u.name AS elder_name
      FROM help_requests hr
      JOIN users u ON hr.elder_id = u.id
      WHERE hr.volunteer_id=?
      AND hr.status='accepted'
      ORDER BY hr.id DESC
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
    // เช็คก่อนว่าเคสยังเปิดอยู่ไหม
    const [check] = await db.query(
      "SELECT id, status, elder_id FROM help_requests WHERE id=? AND volunteer_id=?",
      [req.params.id, req.session.user.id]
    );

    if (!check.length) {
      return res.send(`
        <script>
          alert("❌ ไม่พบเคสนี้");
          window.location.href = "/volunteer/mycase";
        </script>
      `);
    }

    if (check[0].status === "completed") {
      return res.send(`
        <script>
          alert("⚠️ เคสนี้ถูกจบไปแล้ว");
          window.location.href = "/volunteer/history";
        </script>
      `);
    }

    await db.query(
      "UPDATE help_requests SET status='completed', completed_at=NOW() WHERE id=? AND volunteer_id=?",
      [req.params.id, req.session.user.id]
    );

    // แจ้งผู้สูงอายุในไลน์
    const [elder] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [check[0].elder_id]
    );

    if (elder[0]?.line_user_id) {
      await safePush(elder[0].line_user_id, {
        type: "text",
        text: "🎉 เคสของคุณเสร็จสิ้นแล้ว ขอบคุณที่ใช้บริการ SmartCompanion 💙"
      });
    }

    // แจ้งอาสาในไลน์
    const [vol] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [req.session.user.id]
    );

    if (vol[0]?.line_user_id) {
      await safePush(vol[0].line_user_id, {
        type: "text",
        text: "✅ ปิดเคสเรียบร้อยแล้ว ขอบคุณที่ช่วยเหลือผู้สูงอายุ 🙏"
      });
    }

    return res.send(`
      <script>
        window.location.href = "/volunteer/history";
      </script>
    `);

  } catch (err) {
    console.log(err);
    return res.send(`
      <script>
        alert("❌ เกิดข้อผิดพลาด กรุณาลองใหม่");
        window.location.href = "/volunteer/mycase";
      </script>
    `);
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