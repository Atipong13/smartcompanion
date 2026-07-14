const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { safePush } = require("../utils/safePush");
const bcrypt = require("bcrypt");

/* ======================
   Middleware ตรวจสิทธิ์อาสา
====================== */
async function isVolunteer(req, res, next) {

  if (!req.session.user) {
    return res.redirect("/login");
  }

  if (req.session.user.role !== "volunteer") {
    return res.redirect("/");
  }

  try {
    const [rows] = await db.query(
      "SELECT role, status FROM users WHERE id=?",
      [req.session.user.id]
    );

    if (!rows.length || rows[0].role !== "volunteer" || rows[0].status !== "approved") {
      return req.session.destroy(() => {
        return res.redirect("/login");
      });
    }

    next();

  } catch (err) {
    console.log("isVolunteer check error:", err);
    return res.redirect("/login");
  }
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

    // เช็คว่ามีเคสค้าง
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

    res.render("volunteer_mycase", { data: rows || [] });

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
    // เช็คว่าเคสยังเปิดอยู่ไหม
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

    const volunteerId = req.session.user.id;

    /* ---------- ประวัติคำขอช่วยเหลือปกติ (help_requests) ---------- */
    const [normalRows] = await db.query(`
      SELECT hr.*, u.name AS elder_name
      FROM help_requests hr
      JOIN users u ON hr.elder_id = u.id
      WHERE hr.volunteer_id = ?
      AND hr.status = 'completed'
      ORDER BY hr.id DESC
    `, [volunteerId]);

    for (let row of normalRows) {
      const [messages] = await db.query(`
        SELECT m.*, u.name
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.request_id = ?
        ORDER BY m.created_at ASC
      `, [row.id]);

      row.messages = messages;
      row.urgency = 'normal';
    }

    /* ---------- ประวัติเคสด่วนจาก AI (cases) ---------- */
    const [urgentRows] = await db.query(`
      SELECT c.*,
       u.name AS elder_name,
       c.message AS detail,
       c.created_at AS completed_at
FROM cases c
LEFT JOIN users u ON c.line_user_id = u.line_user_id
WHERE c.volunteer_id = ?
AND c.status = 'done'
ORDER BY c.id DESC
    `, [volunteerId]);

    for (let row of urgentRows) {
      const [messages] = await db.query(`
        SELECT cm.*, u.name
        FROM case_messages cm
        JOIN users u ON cm.sender_id = u.id
        WHERE cm.case_id = ?
        ORDER BY cm.created_at ASC
      `, [row.id]);

      row.messages = messages;
      row.urgency = 'urgent';
    }

    /* ---------- รวมสองประเภท เรียงตามวันที่จบล่าสุด ---------- */
    const data = [...normalRows, ...urgentRows].sort((a, b) => {
      const dateA = new Date(a.completed_at || 0);
      const dateB = new Date(b.completed_at || 0);
      return dateB - dateA;
    });

    res.render("volunteer_history", { data });

  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาด");
  }
});

/* =========================
แก้ไขโปรไฟล์
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

  res.render("volunteer_editprofile", {
    user: rows[0],
    success: null,
    error: null
  });

});

/* =========================
   อัปเดต โปรไฟล์

========================= */
router.post("/edit-profile", isVolunteer, async (req, res) => {

  const volunteerId = req.session.user.id;

  const {
    name,
    phone,
    age,
    area,
    experience,
    password,
    confirm
  } = req.body;

  const skills = req.body["skill[]"] || [];

  const rerender = async (error) => {
    const [rows] = await db.query("SELECT * FROM users WHERE id=?", [volunteerId]);
    return res.render("volunteer_editprofile", {
      user: rows[0],
      success: null,
      error
    });
  };

  // ✅ ชื่อต้องเป็นภาษาไทยเท่านั้น (เหมือนตอนสมัคร)
  const thaiNameRegex = /^[ก-๙\s]+$/;
  if (!name || !thaiNameRegex.test(name)) {
    return rerender("กรุณากรอกชื่อเป็นภาษาไทยเท่านั้น");
  }

  // ✅ เบอร์โทร 10 หลัก ตัวเลขเท่านั้น
  const phoneRegex = /^[0-9]{10}$/;
  if (!phone || !phoneRegex.test(phone)) {
    return rerender("เบอร์โทรต้องเป็นตัวเลข 10 หลักเท่านั้น");
  }

  // ✅ อายุ ต้องเป็นตัวเลข 2 หลักเท่านั้น
  const ageRegex = /^[0-9]{2}$/;
  if (!age || !ageRegex.test(age)) {
    return rerender("อายุต้องเป็นตัวเลข 2 หลักเท่านั้น");
  }

  if (!area) {
    return rerender("กรุณาเลือกพื้นที่");
  }

  /* ======================
     ถ้ามีเปลี่ยนรหัสผ่าน → ตรวจตามนโยบายเดิม
  ====================== */
  if (password && password.trim() !== "") {

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8,}$/;

    if (!passwordRegex.test(password)) {
      return rerender("รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมี A-Z a-z และตัวเลข ห้ามใช้ภาษาไทย");
    }

    if (password !== confirm) {
      return rerender("รหัสผ่านไม่ตรงกัน");
    }

    const hashed = await bcrypt.hash(password, 10);

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
        Array.isArray(skills) ? skills.join(",") : skills,
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
        Array.isArray(skills) ? skills.join(",") : skills,
        experience,
        volunteerId
      ]
    );

  }

  const [rows] = await db.query(
    "SELECT * FROM users WHERE id=?",
    [volunteerId]
  );

  res.render("volunteer_editprofile", {
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