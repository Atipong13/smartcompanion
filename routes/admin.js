const express = require("express");
const router = express.Router();
const db = require("../config/db");
const line = require("@line/bot-sdk");
const ExcelJS = require("exceljs");

/* =========================
   LINE CLIENT
========================= */
const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN
});

/* =========================
   MIDDLEWARE CHECK LOGIN
========================= */
function isAdmin(req,res,next){

  if(!req.session.user){
    return res.redirect("/login");
  }

  if(req.session.user.role !== "admin"){
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

  LEFT JOIN users elderly
  ON h.elder_id = elderly.id

  LEFT JOIN users volunteer
  ON h.volunteer_id = volunteer.id

  ORDER BY h.id DESC
`;

    const [rows] = await db.query(sql);

    res.render("admin_dashboard", { data: rows });

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
router.get("/edit-user/:id", isAdmin, async (req,res)=>{

  const id = req.params.id;

  const [rows] = await db.query(
    "SELECT * FROM users WHERE id=?",
    [id]
  );

  res.render("edit_user",{ user:rows[0] });

});
router.post("/edit-user/:id", isAdmin, async (req,res)=>{

  const id = req.params.id;
  const {name,role,status} = req.body;

  await db.query(
    "UPDATE users SET name=?, role=?, status=? WHERE id=?",
    [name,role,status,id]
  );

  res.redirect("/admin/users");

});
router.post("/delete-user/:id", isAdmin, async (req,res)=>{

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

    const [rows] = await db.query(`
      SELECT hr.*, u.name AS volunteer_name
      FROM help_requests hr
      LEFT JOIN users u ON hr.volunteer_id = u.id
      WHERE hr.status='accepted'
      ORDER BY hr.id DESC
    `);

    res.render("admin_working", { data: rows || [] });

  } catch (err) {
    res.send("DB ERROR");
  }

});
/* =========================
   REPORTS
   /admin/reports
========================= */router.get("/reports", isAdmin, async (req, res) => {

  try {

    const [[total]] = await db.query(
      "SELECT COUNT(*) as total FROM help_requests"
    );

    const [[working]] = await db.query(
      "SELECT COUNT(*) as total FROM help_requests WHERE status='accepted'"
    );

    const [[done]] = await db.query(
      "SELECT COUNT(*) as total FROM help_requests WHERE status='completed'"
    );

    const [[users]] = await db.query(
      "SELECT COUNT(*) as total FROM users"
    );

    const [[vol]] = await db.query(
      "SELECT COUNT(*) as total FROM users WHERE role='volunteer'"
    );

    const [[elder]] = await db.query(
      "SELECT COUNT(*) as total FROM users WHERE role='elder'"
    );

    const [history] = await db.query(`
      SELECT h.*, 
e.name as elderly_name,
             v.name as volunteer_name
      FROM help_requests h
      LEFT JOIN users e ON h.elder_id = e.id
      LEFT JOIN users v ON h.volunteer_id = v.id
      ORDER BY h.id DESC
      LIMIT 10
    `);

    res.render("reports", {
      totalCases: total.total,
      workingCases: working.total,
      doneCases: done.total,
      totalUsers: users.total,
      totalVolunteers: vol.total,
      totalElders: elder.total,
      history
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
    `,[id]);

    const [messages] = await db.query(`
      SELECT m.*, u.name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.request_id = ?
      ORDER BY m.created_at ASC
    `,[id]);

    res.render("report-detail",{
      caseData: caseData[0],
      messages
    });

  } catch (err) {
    res.send("DB ERROR");
  }
});
/* =========================
   EXPORT EXCEL
   /admin/export/excel
========================= */
router.get("/export/excel", isAdmin, async (req, res) => {
  const [rows] = await db.query(`
    SELECT h.id, e.name AS elder_name,
           v.name AS volunteer_name,
           h.detail, h.status, h.created_at
    FROM help_requests h
    LEFT JOIN users e ON h.elder_id = e.id
    LEFT JOIN users v ON h.volunteer_id = v.id
    ORDER BY h.id DESC
  `);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");

  worksheet.columns = [
    { header: "ID", key: "id" },
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
   LOGOUT
========================= */
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = router;