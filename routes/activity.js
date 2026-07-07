const express = require("express");
const router = express.Router();
const db = require("../config/db");

/* ================= WEB PAGE ================= */

router.get("/", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM activities ORDER BY activity_time DESC"
  );
  res.render("activity", { activities: rows });
});

/* ================= LINE MESSAGE ================= */

async function handleMessage(event, client, user, msg, userStates) {

  /* ===== เมนูเพิ่มเติม ===== */
  if (msg && msg.includes("เมนูเพิ่มเติม")) {
    return getMoreMenuFlex();
  }

  /* ===== ตั้งกิจกรรม ===== */
/* ===== ตั้งกิจกรรม ===== */
if (msg === "ตั้งกิจกรรม") {

  const [rows] = await db.query(
    `SELECT *
     FROM activities
     WHERE created_by=?
     AND status='pending'
     ORDER BY activity_time ASC`,
    [user.id]
  );

  /* ถ้ามีกิจกรรมอยู่ */
  if (rows.length > 0) {

    return [
      {
        type: "text",
        text: "📋 คุณมีกิจกรรมที่ตั้งไว้แล้ว"
      },
      buildActivityFlex(rows)
    ];
  }

  /* ถ้ายังไม่มี */
  return selectTypeMessage();
}

  /* ===== เพิ่มกิจกรรม ===== */
  if (msg === "เพิ่มกิจกรรม") {
    return selectTypeMessage();
  }
/* ===== ดูประวัติ ===== */
if (msg === "ดูประวัติ") {

  const [rows] = await db.query(
    `SELECT *
     FROM activities
     WHERE created_by=?
     ORDER BY activity_time DESC
     LIMIT 10`,
    [user.id]
  );

  if (!rows.length) {
    return {
      type: "text",
      text: "ยังไม่มีประวัติกิจกรรม"
    };
  }

  return buildActivityFlex(rows);
}
/* ===== เลือกประเภท ===== */
if (["ออกกำลังกาย", "กินยา", "อื่นๆ"].includes(msg)) {

  return {
    type: "template",
    altText: "เลือกวันเวลา",

    template: {
      type: "buttons",
      title: "📅 ตั้งเวลา",
      text: `เลือกวันและเวลาสำหรับ "${msg}"`,

      actions: [
        {
          type: "datetimepicker",
          label: "เลือกวันเวลา",
          data: `set_datetime_${msg}`,
          mode: "datetime"
        }
      ]
    }
  };



  delete userStates[user.id];

  return {
    type: "flex",
    altText: "ตั้งกิจกรรมสำเร็จ",
    contents: {
      type: "bubble",

      hero: {
        type: "image",
        url: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },

      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [

          {
            type: "text",
            text: "✅ ตั้งกิจกรรมสำเร็จ",
            weight: "bold",
            size: "xl",
            color: "#00C853"
          },

          {
            type: "text",
            text: title,
            size: "lg",
            weight: "bold"
          },

          {
            type: "text",
            text: `📅 ${date}`,
            size: "md"
          },

          {
            type: "text",
            text: `⏰ ${time}`,
            size: "md"
          }

        ]
      }
    }
  };
}

  /* ===== รับทราบ ===== */
  if (msg === "รับทราบ") {

    await db.query(
      "UPDATE activities SET status='done' WHERE created_by=? AND status='pending'",
      [user.id]
    );

    return {
      type: "text",
      text: "หยุดแจ้งเตือนแล้ว ✅"
    };
  }

  return null;
}

/* ================= POSTBACK ================= */

async function handlePostback(event, client, user) {

  const data = event.postback.data;
  if (data.startsWith("ack_")) {

  const id = data.replace("ack_", "");

  await db.query(
    "UPDATE activities SET status='done' WHERE id=?",
    [id]
  );

  return [
  {
    type: "text",
    text: "รับทราบแล้ว ✅"
  },
  {
    type: "text",
    text: "ระบบจะหยุดแจ้งเตือนกิจกรรมนี้แล้ว"
  }
];
}
/* ===== เลือกวันเวลา ===== */
if (data.startsWith("set_datetime_")) {

  const title =
    data.replace("set_datetime_", "");

  const datetime =
    event.postback.params.datetime;

  await db.query(
    `INSERT INTO activities
    (title, activity_time, created_by, status, notified)
    VALUES (?, ?, ?, 'pending', 0)`,
    [title, datetime, user.id]
  );

  const dt = new Date(datetime);

  const date =
    dt.toLocaleDateString("th-TH");

  const time =
    dt.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit"
    });

  return {
    type: "flex",
    altText: "ตั้งกิจกรรมสำเร็จ",

    contents: {
      type: "bubble",

      hero: {
        type: "image",
        url: "https://images.unsplash.com/photo-1506784983877-45594efa4cbe",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },

      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",

        contents: [

          {
            type: "text",
            text: "✅ ตั้งกิจกรรมสำเร็จ",
            weight: "bold",
            size: "xl",
            color: "#00C853"
          },

          {
            type: "text",
            text: title,
            weight: "bold",
            size: "lg"
          },

          {
            type: "text",
            text: `📅 ${date}`
          },

          {
            type: "text",
            text: `⏰ ${time}`
          }

        ]
      }
    }
  };
}
  /* ===== ลบกิจกรรม ===== */
  if (data.startsWith("delete_")) {

    const id = data.replace("delete_", "");

    await db.query(
      "DELETE FROM activities WHERE id=? AND created_by=?",
      [id, user.id]
    );

    const [rows] = await db.query(
      "SELECT * FROM activities WHERE created_by=? AND status='pending'",
      [user.id]
    );

    if (!rows.length) {
      return { type: "text", text: "ไม่มีกิจกรรมแล้ว" };
    }

    return buildActivityFlex(rows);
  }

  /* ===== เมนูเพิ่มเติม ===== */
  if (data === "menu_more") {
    return getMoreMenuFlex();
  }
/* ===== ยกเลิกกิจกรรมทั้งหมด ===== */
if (data === "cancel_all") {

  await db.query(
    "DELETE FROM activities WHERE created_by=? AND status='pending'",
    [user.id]
  );

  return {
    type: "text",
    text: "❌ ยกเลิกกิจกรรมทั้งหมดแล้ว"
  };
}
  return null;
}

/* ================= FLEX FUNCTIONS ================= */
function selectTypeMessage() {
  return {
    type: "flex",
    altText: "เลือกประเภทกิจกรรม",
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        contents: [
          {
            type: "text",
            text: "เลือกประเภทกิจกรรม",
            weight: "bold",
            size: "xl",
            align: "center",
            color: "#1E88E5"
          },
          {
            type: "text",
            text: "กรุณาเลือกประเภทที่ต้องการ",
            size: "md",
            align: "center",
            color: "#666666",
            wrap: true
          },

          {
            type: "separator",
            margin: "lg"
          },

          // ปุ่ม 1
          {
            type: "button",
            style: "primary",
            color: "#4CAF50",
            height: "sm",
            action: {
              type: "message",
              label: "🏃 ออกกำลังกาย",
              text: "ออกกำลังกาย"
            }
          },

          // ปุ่ม 2
          {
            type: "button",
            style: "primary",
            color: "#FF9800",
            height: "sm",
            margin: "md",
            action: {
              type: "message",
              label: "💊 กินยา",
              text: "กินยา"
            }
          },

          // ปุ่ม 3
          {
            type: "button",
            style: "primary",
            color: "#2196F3",
            height: "sm",
            margin: "md",
            action: {
              type: "message",
              label: "📝 อื่นๆ",
              text: "อื่นๆ"
            }
          }
        ]
      }
    }
  };
}
function buildActivityFlex(rows) {

  return {
    type: "flex",
    altText: "รายการกิจกรรม",
    contents: {
      type: "carousel",
      contents: rows.map(r => {

        const dt = new Date(r.activity_time);

        const date =
          dt.toLocaleDateString("th-TH");

        const time =
          dt.toLocaleTimeString("th-TH", {
            hour: "2-digit",
            minute: "2-digit"
          });

        let color = "#2196F3";

        if (r.title === "กินยา")
          color = "#E53935";

        if (r.title === "ออกกำลังกาย")
          color = "#43A047";

        return {
          type: "bubble",
          size: "mega",

          header: {
            type: "box",
            layout: "vertical",
            backgroundColor: color,
            contents: [
              {
                type: "text",
                text: r.title,
                color: "#ffffff",
                weight: "bold",
                size: "lg"
              }
            ]
          },

          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [

              {
                type: "text",
                text: `📅 ${date}`,
                size: "md"
              },

              {
                type: "text",
                text: `⏰ ${time}`,
                size: "xl",
                weight: "bold"
              },

              {
                type: "separator"
              }

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
      color: "#00C853",
      action: {
        type: "message",
        label: "➕ เพิ่มกิจกรรม",
        text: "เพิ่มกิจกรรม"
      }
    },

    {
      type: "button",
      style: "secondary",
      color: "#ff4444",
      action: {
        type: "postback",
        label: "🗑 ลบกิจกรรมนี้",
        data: `delete_${r.id}`
      }
    },

    {
      type: "button",
      style: "primary",
      color: "#9E9E9E",
      action: {
        type: "postback",
        label: "❌ ยกเลิกทั้งหมด",
        data: "cancel_all"
      }
    }

  ]
}

        };
      })
    }
  };
}
function getMoreMenuFlex() {

  return {
    type: "flex",
    altText: "เมนูเพิ่มเติม",

    contents: {
      type: "bubble",

      hero: {
        type: "image",
       url: "https://images.unsplash.com/photo-1506784365847-bbad939e9335",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover"
      },

      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",

        contents: [

          {
            type: "text",
            text: "✨ เมนูเพิ่มเติม",
            weight: "bold",
            size: "xl"
          },

          {
            type: "button",
            style: "primary",
            height: "md",
            action: {
              type: "message",
              label: "📅 ตั้งกิจกรรม",
              text: "ตั้งกิจกรรม"
            }
          },

         {
  type: "button",
  style: "secondary",
  height: "md",
  action: {
    type: "message",
    label: "📋 ดูประวัติ",
    text: "ดูประวัติ"
  }

          }

        ]
      }
    }
  };
}
module.exports = router;
module.exports.handleMessage = handleMessage;
module.exports.handlePostback = handlePostback;