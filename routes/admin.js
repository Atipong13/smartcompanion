const express = require("express");
const router = express.Router();
const db = require("../config/db");
const line = require("@line/bot-sdk");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { syncRichMenu } = require("../utils/richMenu");
/* =========================
   LINE CLIENT
========================= */
const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN
});

/* =========================
   MIDDLEWARE CHECK LOGIN
========================= */
function isAdmin(req, res, next) {

  if (!req.session.user) {
    return res.redirect("/login");
  }

  if (req.session.user.role !== "admin") {
    return res.redirect("/");
  }

  next();
}

/* =========================
   DASHBOARD (/admin)
========================= */
router.get("/", isAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT
        h.*,
        elderly.name AS elderly_name,
        volunteer.name AS volunteer_name
      FROM help_requests h
      LEFT JOIN users elderly ON h.elder_id = elderly.id
      LEFT JOIN users volunteer ON h.volunteer_id = volunteer.id
      ORDER BY h.id DESC
    `;
    const [rows] = await db.query(sql);

    // ✅ นับเคสด่วนจาก AI (ตาราง cases)
    const [[highRiskRow]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM cases
      WHERE risk IN ('high','emergency')
    `);

    // ✅ (ถ้าหน้า dashboard ต้องแสดงรายการเคสด่วนด้วย ไม่ใช่แค่ตัวเลข)
    const [highRiskList] = await db.query(`
      SELECT
        c.*,
        e.name AS elderly_name,
        v.name AS volunteer_name
      FROM cases c
      LEFT JOIN users e ON c.line_user_id = e.line_user_id
      LEFT JOIN users v ON c.volunteer_id = v.id
      WHERE c.risk IN ('high','emergency')
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    res.render("admin_dashboard", {
      data: rows,
      highRiskCases: highRiskRow.total,
      highRiskList
    });

  } catch (err) {
    console.log(err);
    res.send("DB ERROR");
  }
});
/* =========================
   USERS LIST
   /admin/users
========================= */
router.get("/users", isAdmin, async (req, res) => {

  try {

    const [rows] = await db.query(
      "SELECT * FROM users ORDER BY id DESC"
    );

    res.render("admin_users", { users: rows });

  } catch (err) {
    res.send("DB ERROR");
  }

});
router.get("/edit-user/:id", isAdmin, async (req, res) => {
  const id = req.params.id;
  const [rows] = await db.query(
    "SELECT id, name, phone, role, status, area, age, skill, experience, line_user_id FROM users WHERE id=?",
    [id]
  );
  res.render("admin_edituser", { user: rows[0] });
});
router.post("/edit-user/:id", isAdmin, async (req,res)=>{

  const id = req.params.id;
  const {name,role,status} = req.body;

  await db.query(
    "UPDATE users SET name=?, role=?, status=? WHERE id=?",
    [name,role,status,id]
  );

  const [rows] = await db.query(
    "SELECT line_user_id FROM users WHERE id=?",
    [id]
  );

  if (rows.length && rows[0].line_user_id) {
    try {
      await syncRichMenu(rows[0].line_user_id);
    } catch (e) {
      console.log("Rich menu error:", e.response?.data || e.message);
    }
  }

  res.redirect("/admin/users");

});
router.post("/delete-user/:id", isAdmin, async (req, res) => {

  const id = req.params.id;

  await db.query(
    "DELETE FROM users WHERE id=?",
    [id]
  );

  res.redirect("/admin/users");

});

/* =========================
   รายชื่ออาสารออนุมัติ
   /admin/volunteers
========================= */
router.get("/volunteers", isAdmin, async (req, res) => {

  try {

    const [rows] = await db.query(
      "SELECT * FROM users WHERE role='volunteer' AND status='pending'"
    );

    res.render("admin_volunteers", { volunteers: rows });

  } catch (err) {
    res.send("DB ERROR");
  }

});

/* =========================
   อนุมัติอาสา
   /admin/approve/:id
========================= */
router.post("/approve/:id", isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // ✅ อนุมัติ — status=approved
    await db.query(
      "UPDATE users SET status='approved' WHERE id=?",
      [userId]
    );

    const [rows] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [userId]
    );

    if (rows.length && rows[0].line_user_id) {
      const lineUserId = rows[0].line_user_id;

      // ✅ แจ้งอาสาว่าได้รับการอนุมัติ
      try {
        await client.pushMessage(lineUserId, {
          type: "text",
          text: "🎉 ยินดีด้วย! คุณได้รับการอนุมัติเป็นอาสาแล้ว\n✅ เมนูของคุณได้รับการอัปเดตแล้ว"
        });
      } catch (e) {
        console.log("Push error:", e.response?.data || e.message);
      }

      await new Promise(r => setTimeout(r, 500));

      // ✅ ใช้ syncRichMenu แทน hardcode — จะเช็ค role+status ให้อัตโนมัติ
      try {
        await syncRichMenu(lineUserId);
      } catch (e) {
        console.log("Rich menu error:", e.response?.data || e.message);
      }

    } else {
      console.log("No LINE ID found");
    }

    res.redirect("/admin/volunteers");

  } catch (err) {
    console.error("Approve error:", err.response?.data || err.message);
    res.redirect("/admin/volunteers");
  }
});

// ✅ reject — เปลี่ยนกลับเป็น elder ด้วย
router.post("/reject/:id", isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // ✅ reject — เปลี่ยน role กลับเป็น elder ด้วย
    await db.query(
      "UPDATE users SET status='rejected', role='elder' WHERE id=?",
      [userId]
    );

    const [rows] = await db.query(
      "SELECT line_user_id FROM users WHERE id=?",
      [userId]
    );

    if (rows.length && rows[0].line_user_id) {
      const lineUserId = rows[0].line_user_id;

      try {
        await client.pushMessage(lineUserId, {
          type: "text",
          text: "❌ การสมัครอาสาของคุณไม่ได้รับการอนุมัติ"
        });
      } catch (e) {
        console.log("Push error:", e.response?.data || e.message);
      }

      // ✅ เปลี่ยนเมนูกลับเป็น elder
      try {
        await syncRichMenu(lineUserId);
      } catch (e) {
        console.log("Rich menu error:", e.response?.data || e.message);
      }
    }

    res.redirect("/admin/volunteers");

  } catch (err) {
    console.log(err);
    res.redirect("/admin/volunteers");
  }
});

/* =========================
   เคสที่กำลังทำ
   /admin/working
========================= */
router.get("/working", isAdmin, async (req, res) => {

  try {

    // เคสปกติจาก help_requests
    const [normalRows] = await db.query(`
      SELECT hr.id,
             hr.detail AS detail,
             hr.status,
             hr.urgency,
             u.name AS volunteer_name,
             e.name AS elderly_name,
             'normal' AS source
      FROM help_requests hr
      LEFT JOIN users u ON hr.volunteer_id = u.id
      LEFT JOIN users e ON hr.elder_id = e.id
      WHERE hr.status='accepted'
    `);

    // เคสด่วนจาก AI จากตาราง cases
    const [aiRows] = await db.query(`
      SELECT c.id,
             c.message AS detail,
             c.status,
             c.risk AS urgency,
             v.name AS volunteer_name,
             e.name AS elderly_name,
             'ai' AS source
      FROM cases c
      LEFT JOIN users v ON c.volunteer_id = v.id
      LEFT JOIN users e ON c.line_user_id = e.line_user_id
      WHERE c.status='accepted'
    `);

    const rows = [...aiRows, ...normalRows]
      .sort((a, b) => b.id - a.id);

    res.render("admin_working", { data: rows || [] });

  } catch (err) {
    res.send("DB ERROR");
  }

});
/* =========================
   REPORTS
   /admin/reports
========================= */
router.get("/reports", isAdmin, async (req, res) => {

  try {

    // ===== Filter =====
    const filter = req.query.filter || "all";

    let where = "";

    if (filter === "day") {
      where = "WHERE DATE(created_at)=CURDATE()";
    } else if (filter === "month") {
      where = `
      WHERE MONTH(created_at)=MONTH(CURDATE())
      AND YEAR(created_at)=YEAR(CURDATE())
      `;
    } else if (filter === "year") {
      where = `
      WHERE YEAR(created_at)=YEAR(CURDATE())
      `;
    }

    // ===== KPI =====

    const [[total]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM help_requests
      ${where}
    `);

    const [[working]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM help_requests
      ${where}
      ${where ? "AND" : "WHERE"} status='accepted'
    `);

    const [[done]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM help_requests
      ${where}
      ${where ? "AND" : "WHERE"} status='completed'
    `);

    const [[users]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM users
    `);

    const [[vol]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role='volunteer'
    `);

    const [[elder]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role='elder'
    `);

    // ===== AI High Risk / Emergency =====

    const highRiskWhere = where
      ? where.replace(/created_at/g, "m.created_at") + " AND m.risk IN ('high','emergency')"
      : "WHERE m.risk IN ('high','emergency')";

    const [[highRisk]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM cases m
      ${highRiskWhere}
    `);

    const [highRiskList] = await db.query(`
      SELECT
        m.*,
        u.name AS elderly_name,
        v.name AS volunteer_name
      FROM cases m
      LEFT JOIN users u
      ON m.line_user_id = u.line_user_id
      LEFT JOIN users v
      ON m.volunteer_id = v.id
      ${highRiskWhere}
      ORDER BY m.created_at DESC
      LIMIT 10
    `);

    // ===== History =====

    const [history] = await db.query(`
      SELECT
        h.*,
        e.name AS elderly_name,
        v.name AS volunteer_name
      FROM help_requests h
      LEFT JOIN users e
      ON h.elder_id=e.id
      LEFT JOIN users v
      ON h.volunteer_id=v.id
      ${where.replace(/created_at/g, "h.created_at")}
      ORDER BY h.id DESC
      LIMIT 10
    `);

    res.render("admin_reports", {

      totalCases: total.total,
      workingCases: working.total,
      doneCases: done.total,

      totalUsers: users.total,
      totalVolunteers: vol.total,
      totalElders: elder.total,

      highRiskCases: highRisk.total,
      highRiskList,

      history,

      filter

    });

  } catch (err) {

    console.log(err);

    res.send("DB ERROR");

  }

});


/* =========================
   REPORT DETAIL
   /admin/reports/:id
========================= */
router.get("/reports/:id", isAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const [caseData] = await db.query(`
      SELECT h.*, 
e.name as elderly_name,             v.name as volunteer_name
      FROM help_requests h
      LEFT JOIN users e ON h.elder_id = e.id
      LEFT JOIN users v ON h.volunteer_id = v.id
      WHERE h.id = ?
    `, [id]);

    const [messages] = await db.query(`
      SELECT m.*, u.name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.request_id = ?
      ORDER BY m.created_at ASC
    `, [id]);

    res.render("admin_reportdetail", {
      caseData: caseData[0],
      messages
    });

  } catch (err) {
    res.send("DB ERROR");
  }
});

/* =========================
   CASE DETAIL (เคส AI)
========================= */
router.get("/case-report/:id", isAdmin, async (req, res) => {
  try {
    const id = req.params.id;

    const [caseRows] = await db.query(`
      SELECT
        c.*,
        e.name AS elderly_name,
        v.name AS volunteer_name
      FROM cases c
      LEFT JOIN users e ON c.line_user_id = e.line_user_id
      LEFT JOIN users v ON c.volunteer_id = v.id
      WHERE c.id = ?
    `, [id]);

    if (!caseRows.length) {
      return res.send("ไม่พบเคสนี้");
    }

    const [messages] = await db.query(`
      SELECT cm.*, u.name
      FROM case_messages cm
      JOIN users u ON cm.sender_id = u.id
      WHERE cm.case_id = ?
      ORDER BY cm.created_at ASC
    `, [id]);

    res.render("volunteer_casedetail", {
      caseData: caseRows[0],
      messages
    });

  } catch (err) {
    console.log(err);
    res.send("DB ERROR");
  }
});
/* =========================
   EXPORT EXCEL
   /admin/export/excel
========================= */
router.get("/export/excel", isAdmin, async (req, res) => {
  const [normalRows] = await db.query(`
    SELECT h.id, e.name AS elder_name,
           v.name AS volunteer_name,
           h.detail, h.status, h.created_at
    FROM help_requests h
    LEFT JOIN users e ON h.elder_id = e.id
    LEFT JOIN users v ON h.volunteer_id = v.id
    ORDER BY h.id DESC
  `);

  normalRows.forEach(r => { r.type = "เคสปกติ"; });

  const [urgentRows] = await db.query(`
    SELECT c.id, e.name AS elder_name,
           v.name AS volunteer_name,
           c.message AS detail, c.status, c.created_at
    FROM cases c
    LEFT JOIN users e ON c.line_user_id = e.line_user_id
    LEFT JOIN users v ON c.volunteer_id = v.id
    ORDER BY c.id DESC
  `);

  urgentRows.forEach(r => { r.type = "เคสด่วน (AI)"; });

  const rows = [...normalRows, ...urgentRows].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");

  worksheet.columns = [
    { header: "ID", key: "id" },
    { header: "ประเภท", key: "type" },
    { header: "ผู้สูงอายุ", key: "elder_name" },
    { header: "อาสา", key: "volunteer_name" },
    { header: "รายละเอียด", key: "detail" },
    { header: "สถานะ", key: "status" },
    { header: "วันที่", key: "created_at" }
  ];

  worksheet.addRows(rows);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=SmartCompanion_Report.xlsx"
  );

  await workbook.xlsx.write(res);
  res.end();
});

/* =========================
   EXPORT PDF
   /admin/export/pdf
========================= */
router.get("/export/pdf", isAdmin, async (req, res) => {
  try {
    const [normalRows] = await db.query(`
      SELECT h.id, e.name AS elder_name,
             v.name AS volunteer_name,
             h.detail, h.status, h.created_at
      FROM help_requests h
      LEFT JOIN users e ON h.elder_id = e.id
      LEFT JOIN users v ON h.volunteer_id = v.id
      ORDER BY h.id DESC
    `);

    normalRows.forEach(r => { r.type = "ปกติ"; });

    const [urgentRows] = await db.query(`
      SELECT c.id, e.name AS elder_name,
             v.name AS volunteer_name,
             c.message AS detail, c.status, c.created_at
      FROM cases c
      LEFT JOIN users e ON c.line_user_id = e.line_user_id
      LEFT JOIN users v ON c.volunteer_id = v.id
      ORDER BY c.id DESC
    `);

    urgentRows.forEach(r => { r.type = "AI ด่วน"; });

    const rows = [...normalRows, ...urgentRows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const doc = new PDFDocument({ margin: 30, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=SmartCompanion_Report.pdf"
    );

    doc.pipe(res);

    /* ===== TITLE ===== */
    doc.fontSize(18).text("SmartCompanion Report", { align: "center" });
    doc.moveDown();

    doc.fontSize(10).text(`Total records: ${rows.length}`);
    doc.moveDown();

    /* ===== TABLE HEADER ===== */
    doc.fontSize(10).text(
      "ID | Type | Elder | Volunteer | Detail | Status | Date"
    );

    doc.moveTo(30, doc.y).lineTo(580, doc.y).stroke();
    doc.moveDown(0.5);

    /* ===== ROWS ===== */
    rows.forEach((r, i) => {
      const line =
        `${r.id} | ` +
        `${r.type} | ` +
        `${r.elder_name || "-"} | ` +
        `${r.volunteer_name || "-"} | ` +
        `${(r.detail || "").substring(0, 20)} | ` +
        `${r.status} | ` +
        `${r.created_at ? new Date(r.created_at).toLocaleDateString("th-TH") : "-"}`;

      doc.fontSize(9).text(line);
      doc.moveDown(0.3);

      // กัน PDF ล้นหน้า
      if (i % 35 === 0 && i !== 0) {
        doc.addPage();
      }
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).send("PDF export error");
  }
});
/* =========================
   LOGOUT
========================= */
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;