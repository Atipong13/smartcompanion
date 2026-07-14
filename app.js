require("dotenv").config();

const line        = require("@line/bot-sdk");
const express     = require("express");
const session     = require("express-session");
const path        = require("path");
const fs          = require("fs");
const cron        = require("node-cron");
const { sign } = require("./utils/regToken");
const db            = require("./config/db");
const helpRoute     = require("./routes/help");
const activityRoute = require("./routes/activity");
const forgetRoutes  = require("./routes/forget");

const { init: initPush, safePush } = require("./utils/safePush");
const generateVoice = require("./utils/voiceService");

const { handleLocation }     = require("./handlers/locationHandler");
const { handleCasePostback } = require("./handlers/caseHandler");
const { handleCaseChat }     = require("./handlers/chatHandler");
const { handleAIText, handleAIAudio } = require("./handlers/aiHandler");

/* ================= ENV CHECK ================= */
// ✅ เช็ค env ที่จำเป็นตอน start เพื่อ fail เร็วแทนที่จะพังกลางทางตอนมี user ใช้งานจริง
const REQUIRED_ENV = [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_TOKEN",
  "BASE_URL",
  "SESSION_SECRET"
];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length) {
  console.error("❌ ขาด environment variables:", missingEnv.join(", "));
  process.exit(1);
}
const BASE_URL = process.env.BASE_URL.trim();

/* ================= APP SETUP ================= */
const app        = express();
const userStates = {};

const audioDir = path.join(process.cwd(), "public/audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

app.use("/audio", express.static(audioDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".mp3")) res.setHeader("Content-Type", "audio/mpeg");
    if (filePath.endsWith(".m4a")) res.setHeader("Content-Type", "audio/mp4");
  }
}));

// ✅ ลบไฟล์เสียงที่เก่ากว่า 1 ชั่วโมง อัตโนมัติ
cron.schedule("0 * * * *", () => {
  try {
    const files = fs.readdirSync(audioDir);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(audioDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log("🗑 ลบไฟล์เสียงเก่า:", file);
      }
    });
  } catch (err) {
    console.error("❌ ลบไฟล์เสียงไม่สำเร็จ:", err.message);
  }
});

/* ================= LINE CONFIG ================= */
const config = {
  channelSecret:      process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
};
const client = new line.Client(config);
initPush(client); // ✅ ส่ง client ให้ safePush ใช้



/* ================= CRON ================= */
let cronRunning = false;
cron.schedule("* * * * *", async () => {
  if (cronRunning) return;
  cronRunning = true;
  try {
    const now = new Date();

    // แจ้งเตือนกิจกรรม
    const [rows] = await db.query(`
      SELECT a.*, u.line_user_id FROM activities a
      JOIN users u ON a.created_by=u.id
      WHERE a.status='pending' AND a.activity_time <= ?
      AND (a.last_notified_at IS NULL OR TIMESTAMPDIFF(MINUTE, a.last_notified_at, NOW()) >= 2)
    `, [now]);

    for (const act of rows) {
      try {
        // ตรวจสอบข้อมูลก่อน push
        if (!act.line_user_id) {
          console.log("⚠️ ไม่มี line_user_id, ข้าม activity id:", act.id);
          continue;
        }
        if (!act.title) {
          console.log("⚠️ ไม่มี title, ข้าม activity id:", act.id);
          continue;
        }

        const title = act.title.substring(0, 40);  // LINE limit 40 ตัว
        const text  = act.title.substring(0, 60);  // LINE limit 60 ตัว

        console.log("📤 Push to:", act.line_user_id, "| activity:", act.id, "|", title);

        await safePush(act.line_user_id, {
          type: "template",
          altText: "แจ้งเตือนกิจกรรม: " + title,
          template: {
            type: "buttons",
            title: "⏰ " + title,
            text: text,
            actions: [{ type: "postback", label: "รับทราบ", data: "ack_" + act.id }]
          }
        });

        await db.query("UPDATE activities SET last_notified_at=NOW() WHERE id=?", [act.id]);
        await new Promise(r => setTimeout(r, 800));

      } catch (err) {
        console.log("❌ Push Error activity id:", act.id);
        console.log("❌ Detail:", JSON.stringify(err.response?.data, null, 2) || err.message);
      }
    }

    // ออก AI mode อัตโนมัติ (ไม่โต้ตอบ 2 นาที)
    const [expired] = await db.query(`
      SELECT id, line_user_id FROM users
      WHERE ai_mode=1 AND ai_last_active IS NOT NULL
      AND TIMESTAMPDIFF(MINUTE, ai_last_active, NOW()) >= 2
    `);
    for (const u of expired) {
      await db.query("UPDATE users SET ai_mode=0 WHERE id=?", [u.id]);
      await safePush(u.line_user_id, { type: "text", text: "⏱ ไม่มีการใช้งาน AI ครบ 2 นาที\nออกจากโหมด AI อัตโนมัติแล้ว 👋" });
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.log("❌ Cron error:", err);
  } finally {
    // ✅ ใช้ finally กัน cronRunning ค้าง true ตลอดไปถ้ามี error หลุดจาก try
    cronRunning = false;
  }
});

/* ================= WEBHOOK ================= */
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err);
    res.sendStatus(500);
  }
});

/* ================= EVENT HANDLER ================= */
async function handleEvent(event) {
  if (!event.source?.userId) return null;

  const userId = event.source.userId;

  // ดึงชื่อจาก LINE (ถ้าไม่ได้ → null ไม่ใช้ค่า default)
  let name = null;
  try {
    name = (await client.getProfile(userId)).displayName;
  } catch (e) {
    console.error("getProfile failed:", userId, e?.message);
  }

  // ดึง/สร้าง user
  // ✅ ป้องกัน race condition (webhook ซ้ำ/ข้อความติดกันเร็ว) ด้วย INSERT ... ON DUPLICATE KEY UPDATE
  // หมายเหตุ: ต้องมี UNIQUE KEY บนคอลัมน์ line_user_id ในตาราง users
  await db.query(
    `INSERT INTO users (line_user_id, name, role, status)
     VALUES (?, ?, 'elder', 'approved')
     ON DUPLICATE KEY UPDATE line_user_id = line_user_id`,
    [userId, name ?? userId]
  );

  const [users] = await db.query("SELECT * FROM users WHERE line_user_id=?", [userId]);
  let user = users[0];

  // ✅ อัปเดตชื่อจาก LINE เฉพาะกรณีที่ user ยังไม่เคยตั้งชื่อเอง (ชื่อว่าง หรือเป็น userId เดิม)
  if (name && (!user.name || user.name === userId)) {
    await db.query("UPDATE users SET name=? WHERE line_user_id=?", [name, userId]);
    user.name = name;
  }

  // follow
  if (event.type === "follow") {
    await syncRichMenu(userId);
    return null;
  }

  // postback
  if (event.type === "postback") {
    const caseReply = await handleCasePostback(event, user, client, userStates);
    if (caseReply) return client.replyMessage(event.replyToken, caseReply);

    const actRes = await activityRoute.handlePostback(event, client, user, userStates);
    if (actRes) return client.replyMessage(event.replyToken, actRes);

    const helpRes = await helpRoute.handlePostback(event, user);
    if (helpRes) return client.replyMessage(event.replyToken, helpRes);

    return null;
  }

  // case_chat mode
  if (userStates[userId]?.mode === "case_chat") {
    const reply = await handleCaseChat(event, userId, userStates, client);
    if (reply) return client.replyMessage(event.replyToken, reply);
    return null;
  }

  // message
  if (event.type === "message") {
    if (!event.message) return null;

    // location
    if (event.message.type === "location") return handleLocation(event, user, client);

    // audio
    if (event.message.type === "audio") {
      if (user.ai_mode == 1) return handleAIAudio(event, user, client);
      const helpRes = await helpRoute.handleMessage(event, user);
      if (helpRes) return client.replyMessage(event.replyToken, helpRes);
      return null;
    }

    // text
    if (event.message.type === "text") {
      const msg = event.message.text.trim();

      if (msg === "พูดคุยกับ AI") {
        await db.query("UPDATE users SET ai_mode=1, ai_last_active=NOW() WHERE id=?", [user.id]);
        return client.replyMessage(event.replyToken, {
          type: "text", text: "🤖 เปิด AI แล้ว พูดหรือพิมพ์ได้เลย",
          quickReply: { items: [{ type: "action", action: { type: "message", label: "❌ ออกจาก AI", text: "ออกจาก AI" } }] }
        });
      }

      if (msg === "ออกจาก AI") {
        await db.query("UPDATE users SET ai_mode=0 WHERE id=?", [user.id]);
        return client.replyMessage(event.replyToken, { type: "text", text: "ออกจาก AI แล้ว 👋" });
      }

      if (msg === "สมัครอาสา") {
        // ✅ กันไม่ให้ downgrade role โดยไม่ตั้งใจ (admin หรือ volunteer ที่ approved อยู่แล้ว)
        if (user.role === "admin") {
          return client.replyMessage(event.replyToken, {
            type: "text", text: "บัญชีนี้เป็นแอดมินอยู่แล้วค่ะ ไม่สามารถสมัครเป็นอาสาซ้ำได้"
          });
        }
        if (user.role === "volunteer" && user.status === "approved") {
          return client.replyMessage(event.replyToken, {
            type: "text", text: "คุณเป็นอาสาที่ได้รับอนุมัติอยู่แล้วนะคะ 🙏"
          });
        }
        if (user.role === "volunteer" && user.status === "pending") {
          return client.replyMessage(event.replyToken, {
            type: "text", text: "ใบสมัครของคุณอยู่ระหว่างรอ admin อนุมัติค่ะ ⏳"
          });
        }

        await db.query("UPDATE users SET role='volunteer', status='pending' WHERE line_user_id=?", [userId]);
        const regToken   = sign(userId);
        const registerUrl = BASE_URL + "/volunteer/register?uid=" + userId + "&token=" + regToken;
        const imageUrl     = BASE_URL + "/images/smart.jpg";
        return client.replyMessage(event.replyToken, {
          type: "flex", altText: "สมัครเป็นอาสา SmartCompanion",
          contents: {
            type: "bubble", size: "mega",
            hero: { type: "image", url: imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" },
            body: {
              type: "box", layout: "vertical",
              contents: [
                { type: "text", text: "🤝 สมัครเป็นอาสา", weight: "bold", size: "xl" },
                { type: "text", text: "ร่วมช่วยเหลือผู้สูงอายุในชุมชนของคุณ", size: "sm", color: "#666666", margin: "md", wrap: true },
                { type: "text", text: "⏳ กรุณารอ admin อนุมัติก่อน เมนูจะเปลี่ยนอัตโนมัติ", size: "xs", color: "#f39c12", margin: "md", wrap: true }
              ]
            },
            footer: {
              type: "box", layout: "vertical",
              contents: [{ type: "button", style: "primary", color: "#0077ff", action: { type: "uri", label: "📝 กรอกฟอร์มสมัครที่นี่", uri: registerUrl } }]
            }
          }
        });
      }

      if (msg === "ดูประวัติ") {
        return handleHistory(event, user, client);
      }

      // AI mode
      if (user.ai_mode == 1) return handleAIText(event, user, client, msg);

      // routes อื่น
      const actRes = await activityRoute.handleMessage(event, client, user, msg, userStates);
      if (actRes) return client.replyMessage(event.replyToken, actRes);

      const helpRes = await helpRoute.handleMessage(event, user);
      if (helpRes) return client.replyMessage(event.replyToken, helpRes);

      return client.replyMessage(event.replyToken, { type: "text", text: "กรุณาใช้เมนู" });
    }
  }

  return null;
}
/* ================= HISTORY HANDLER ================= */
async function handleHistory(event, user, client) {
  const safeText = (text, len = 35) => text ? text.substring(0, len) : "-";
  const formatDate = (date) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const statusColor = (s) =>
    s === "completed" || s === "done" ? "#27ae60" :
    s === "waiting" || s === "open" ? "#f39c12" :
    s === "accepted" ? "#2980b9" :
    s === "cancelled" ? "#e74c3c" : "#888888";

  // ระดับความเสี่ยงของเคสจาก AI (ตาราง cases) -> label + สี ให้ตรงกับความจริง
  const riskLabel = (risk) => {
    if (risk === "emergency") return { text: "🆘 ฉุกเฉิน", color: "#e74c3c" };
    if (risk === "high")      return { text: "🚨 ความเสี่ยงสูง", color: "#e67e22" };
    if (risk === "medium")    return { text: "⚠️ ความเสี่ยงปานกลาง", color: "#f39c12" };
    return { text: "🟢 ความเสี่ยงต่ำ", color: "#27ae60" };
  };

  // ✅ ประกาศจุดเดียว นอกทุก if — ใช้ร่วมกันได้ทั้ง volunteer และ elder
  const statusLabel = (s) => {
    const map = {
      waiting:   "รอดำเนินการ",
      open:      "รอดำเนินการ",
      accepted:  "กำลังดำเนินการ",
      completed: "เสร็จสิ้น",
      done:      "เสร็จสิ้น",
      cancelled: "ยกเลิก"
    };
    return map[s] || s;
  };

  if (user.role === "volunteer") {

    const [helps] = await db.query(
      `SELECT h.status, h.created_at, u.name AS elder_name
       FROM help_requests h
       JOIN users u ON h.elder_id = u.id
       WHERE h.volunteer_id=? ORDER BY h.created_at DESC LIMIT 5`, [user.id]
    );
    const [chats] = await db.query(
      `SELECT m.message, m.sender_id, m.created_at FROM messages m
       JOIN help_requests h ON m.request_id=h.id WHERE h.volunteer_id=? ORDER BY m.created_at DESC LIMIT 5`, [user.id]
    );
    const [aiCases] = await db.query(
      "SELECT message, risk, status, created_at FROM cases WHERE volunteer_id=? ORDER BY created_at DESC LIMIT 5", [user.id]
    );

    const helpBox = helps.length
      ? helps.map(h => ({ type: "box", layout: "vertical", margin: "sm", spacing: "xs", contents: [
          { type: "text", text: "👵 " + (h.elder_name || "-"), size: "sm", weight: "bold", wrap: true },
          { type: "text", text: statusLabel(h.status), size: "xs", color: statusColor(h.status) },
          { type: "text", text: formatDate(h.created_at), size: "xs", color: "#888888" }
        ]}))
      : [{ type: "text", text: "ไม่มีคำขอช่วยเหลือ", size: "sm", color: "#999999" }];

    const chatBox = chats.length
      ? chats.map(c => ({ type: "box", layout: "vertical", margin: "sm", spacing: "xs", contents: [
          { type: "text", text: c.sender_id === user.id ? "🙋‍♂️ อาสา" : "👵 ผู้สูงอายุ", size: "xs", weight: "bold" },
          { type: "text", text: c.message || "-", size: "sm", wrap: true },
          { type: "text", text: formatDate(c.created_at), size: "xs", color: "#888888" }
        ]}))
      : [{ type: "text", text: "ไม่มีแชท", size: "sm", color: "#999999" }];

    const caseBox = aiCases.length
      ? aiCases.map(c => {
          const r = riskLabel(c.risk);
          return { type: "box", layout: "vertical", margin: "sm", spacing: "xs", contents: [
            { type: "text", text: "🤖 " + (c.message || "-"), size: "sm", weight: "bold", wrap: true },
            { type: "text", text: r.text, size: "xs", color: r.color },
            { type: "text", text: statusLabel(c.status), size: "xs", color: statusColor(c.status) },
            { type: "text", text: formatDate(c.created_at), size: "xs", color: "#888888" }
          ]};
        })
      : [{ type: "text", text: "ไม่มีเคสด่วนจาก AI", size: "sm", color: "#999999" }];

    return client.replyMessage(event.replyToken, {
      type: "flex", altText: "ประวัติของคุณ",
      contents: { type: "carousel", contents: [
        { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: [{ type: "text", text: "🚨 เคสด่วนจาก AI", weight: "bold", size: "lg" }, { type: "separator" }, ...caseBox] } },
        { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: [{ type: "text", text: "🆘 คำขอช่วยเหลือ", weight: "bold", size: "lg" }, { type: "separator" }, ...helpBox] } },
        { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: [{ type: "text", text: "💬 แชทล่าสุด", weight: "bold", size: "lg" }, { type: "separator" }, ...chatBox] } }
      ]}
    });
  }

  // elder
  const [helps] = await db.query(
    `SELECT h.status, h.created_at, v.name AS volunteer_name
     FROM help_requests h
     LEFT JOIN users v ON h.volunteer_id = v.id
     WHERE h.elder_id=? ORDER BY h.created_at DESC LIMIT 5`, [user.id]
  );
  const [activities] = await db.query(
    "SELECT title, status, activity_time FROM activities WHERE created_by=? ORDER BY activity_time DESC LIMIT 5", [user.id]
  );
  const [chats] = await db.query(
    `SELECT m.message, m.sender_id, m.created_at FROM messages m
     JOIN help_requests h ON m.request_id=h.id WHERE h.elder_id=? ORDER BY m.created_at DESC LIMIT 5`, [user.id]
  );
  const [aiCases] = await db.query(
    "SELECT message, risk, status, created_at FROM cases WHERE line_user_id=? ORDER BY created_at DESC LIMIT 5", [user.line_user_id]
  );

  const mkBox = (items, emptyText, fn) =>
    items.length ? items.map(fn) : [{ type: "text", text: emptyText, size: "md", color: "#999999", align: "center", margin: "lg" }];

  const helpBoxes = mkBox(helps, "ไม่มีข้อมูล", i => ({ type: "box", layout: "vertical", margin: "md", contents: [
    { type: "text", text: "🙋‍♂️ " + (i.volunteer_name || "ยังไม่มีอาสารับเคส"), size: "md", wrap: true },
    { type: "text", text: statusLabel(i.status) + " • " + formatDate(i.created_at), size: "sm", color: statusColor(i.status) }
  ]}));
  const actBoxes = mkBox(activities, "ไม่มีข้อมูล", i => ({ type: "box", layout: "vertical", margin: "md", contents: [
    { type: "text", text: "📅 " + safeText(i.title), size: "md", wrap: true },
    { type: "text", text: statusLabel(i.status) + " • " + formatDate(i.activity_time), size: "sm", color: statusColor(i.status) }
  ]}));
  const chatBoxes = mkBox(chats, "ไม่มีแชท", c => ({ type: "box", layout: "vertical", margin: "md", contents: [
    { type: "text", text: (c.sender_id == user.id ? "คุณ: " : "อาสา: ") + safeText(c.message), size: "md", wrap: true },
    { type: "text", text: formatDate(c.created_at), size: "sm", color: "#888888" }
  ]}));
  const caseBoxes = mkBox(aiCases, "ไม่มีเคสด่วน", i => {
    const r = riskLabel(i.risk);
    return { type: "box", layout: "vertical", margin: "md", contents: [
      { type: "text", text: "🤖 " + safeText(i.message), size: "md", wrap: true },
      { type: "text", text: r.text + " • " + statusLabel(i.status) + " • " + formatDate(i.created_at), size: "sm", color: r.color }
    ]};
  });

  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "ประวัติย้อนหลัง",
    contents: { type: "carousel", contents: [
      { type: "bubble", header: { type: "box", layout: "vertical", backgroundColor: "#c0392b", paddingAll: "15px", contents: [{ type: "text", text: "🚨 เคสด่วน (AI)", weight: "bold", size: "lg", color: "#ffffff" }] }, body: { type: "box", layout: "vertical", contents: caseBoxes } },
      { type: "bubble", header: { type: "box", layout: "vertical", backgroundColor: "#2c3e50", paddingAll: "15px", contents: [{ type: "text", text: "🆘 คำขอช่วยเหลือ", weight: "bold", size: "lg", color: "#ffffff" }] }, body: { type: "box", layout: "vertical", contents: helpBoxes } },
      { type: "bubble", header: { type: "box", layout: "vertical", backgroundColor: "#34495e", paddingAll: "15px", contents: [{ type: "text", text: "📅 กิจกรรม", weight: "bold", size: "lg", color: "#ffffff" }] }, body: { type: "box", layout: "vertical", contents: actBoxes } },
      { type: "bubble", header: { type: "box", layout: "vertical", backgroundColor: "#16a085", paddingAll: "15px", contents: [{ type: "text", text: "💬 แชทล่าสุด", weight: "bold", size: "lg", color: "#ffffff" }] }, body: { type: "box", layout: "vertical", contents: chatBoxes } }
    ]}
  });
}
/* ================= EXPRESS CONFIG ================= */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/images", express.static("images"));
app.set("trust proxy", 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production", // https เท่านั้นตอน production
    httpOnly: true,
    sameSite: "lax"
  }
}));
app.use("/", require("./routes/auth"));
app.use("/admin", require("./routes/admin"));
app.use("/volunteer", require("./routes/volunteer"));
app.use("/activity", activityRoute);
app.use("/forgot-password", forgetRoutes);

app.listen(3000, () => console.log("Server running on port 3000"));