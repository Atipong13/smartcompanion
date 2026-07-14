const db  = require("../config/db");
const { safePush } = require("../utils/safePush");

// ✅ ส่ง Flex bubble เดียว: รูปแผนที่ + ปุ่มนำทาง กดครั้งเดียวเด้ง Google Maps เลย
const sendLocationWithNav = async (client, lineUserId, title, lat, lng) => {
  // ✅ กันพังถ้าเผลอเรียกโดยไม่มี lineUserId
  if (!lineUserId) {
    console.warn("⚠️ sendLocationWithNav: lineUserId ว่าง ข้ามการส่ง:", title);
    return;
  }

  const navigateUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  const mapImageUrl =
    `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}` +
    `&zoom=16&size=600x400&maptype=mapnik&markers=${lat},${lng},red-pushpin`;

  try {
    await client.pushMessage(lineUserId, [
      {
        type: "flex",
        altText: title,
        contents: {
          type: "bubble",
          size: "mega",
          hero: {
            type: "image",
            url: mapImageUrl,
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: { type: "uri", uri: navigateUrl }
          },
          body: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: title,
                weight: "bold",
                size: "md",
                wrap: true,
                color: "#1a1a1a"
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "xs",
                margin: "sm",
                contents: [
                  { type: "icon", url: "https://cdn-icons-png.flaticon.com/512/684/684908.png", size: "xs" },
                  {
                    type: "text",
                    text: "แตะที่แผนที่หรือปุ่มด้านล่างเพื่อนำทาง",
                    size: "xs",
                    color: "#999999",
                    flex: 1
                  }
                ]
              }
            ]
          },
          footer: {
            type: "box",
            layout: "vertical",
            paddingAll: "16px",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#27ae60",
                height: "md",
                action: {
                  type: "uri",
                  label: "🗺️ นำทางไปเลย",
                  uri: navigateUrl
                }
              }
            ]
          }
        }
      }
    ]);
  } catch (err) {
    // ✅ ถ้าส่งคนนี้พัง ไม่ throw ขึ้นไปทำให้ทั้งฟังก์ชันพังทั้งหมด แค่ log แล้วไปต่อ
    console.error(`❌ sendLocationWithNav ล้มเหลว (to: ${lineUserId}):`, err?.originalError?.response?.data || err.message);
  }
};

const handleLocation = async (event, user, client) => {
  try {
    const { latitude, longitude } = event.message;

    const [helpCase] = await db.query(
      `SELECT * FROM help_requests WHERE elder_id=? AND status='accepted' ORDER BY id DESC LIMIT 1`,
      [user.id]
    );
    const [aiCase] = await db.query(
      `SELECT * FROM cases WHERE line_user_id=? AND status IN ('open','accepted') ORDER BY id DESC LIMIT 1`,
      [user.line_user_id]
    );

    const hasHelp = helpCase.length > 0;
    const hasAI   = aiCase.length > 0;

    if (!hasHelp && !hasAI) {
      return client.replyMessage(event.replyToken, {
        type: "text", text: "❌ ไม่มีเคสที่รอตำแหน่งค่ะ"
      });
    }

    if (hasHelp) {
      const caseRow = helpCase[0];
      await db.query(
        "UPDATE help_requests SET latitude=?, longitude=? WHERE id=?",
        [latitude, longitude, caseRow.id]
      );
      if (caseRow.volunteer_id) {
        const [vol] = await db.query("SELECT line_user_id FROM users WHERE id=?", [caseRow.volunteer_id]);
        // ✅ เช็คว่ามี record และ line_user_id ไม่ใช่ null/ว่าง
        if (vol.length && vol[0].line_user_id) {
          await sendLocationWithNav(client, vol[0].line_user_id,
            "📍 ตำแหน่งผู้สูงอายุ (เคส #" + caseRow.id + ")", latitude, longitude
          );
        } else {
          console.warn(`⚠️ volunteer_id=${caseRow.volunteer_id} ไม่มี line_user_id (case #${caseRow.id})`);
        }
      }
    }

    if (hasAI) {
      const aiRow = aiCase[0];
      await db.query("UPDATE cases SET lat=?, lng=? WHERE id=?", [latitude, longitude, aiRow.id]);

      if (aiRow.volunteer_id) {
        const [vol] = await db.query("SELECT line_user_id FROM users WHERE id=?", [aiRow.volunteer_id]);
        // ✅ เช็คว่ามี record และ line_user_id ไม่ใช่ null/ว่าง
        if (vol.length && vol[0].line_user_id) {
          await sendLocationWithNav(client, vol[0].line_user_id,
            "🚨 ตำแหน่งผู้ใช้ (เคสเสี่ยง #" + aiRow.id + ")", latitude, longitude
          );
        } else {
          console.warn(`⚠️ volunteer_id=${aiRow.volunteer_id} ไม่มี line_user_id (case #${aiRow.id})`);
        }
      }

      // ✅ กรอง NULL / ว่าง ออกตั้งแต่ระดับ SQL ป้องกันต้นเหตุของปัญหาเดิม
      const [admins] = await db.query(
        "SELECT line_user_id FROM users WHERE role='admin' AND line_user_id IS NOT NULL AND line_user_id != ''"
      );
      for (const a of admins) {
        await sendLocationWithNav(client, a.line_user_id,
          "🚨 ตำแหน่งผู้ใช้ (เคสเสี่ยง #" + aiRow.id + ")", latitude, longitude
        );
      }
    }

    let replyText = "";
    if (hasHelp) replyText += "✅ ส่งตำแหน่งให้อาสาแล้ว\n";
    if (hasAI)   replyText += "✅ ส่งตำแหน่งให้ผู้ดูแลแล้ว\n";
    replyText += "🙏 กำลังดำเนินการช่วยเหลือ";

    return client.replyMessage(event.replyToken, {
      type: "text", text: replyText.trim()
    });

  } catch (err) {
    console.error("❌ Location Error:", err);
    return client.replyMessage(event.replyToken, {
      type: "text", text: "❌ เกิดข้อผิดพลาด"
    });
  }
};

module.exports = { handleLocation };