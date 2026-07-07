const line = require("@line/bot-sdk");
const db = require("../config/db");

const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN
});

const ELDER_MENU_ID     = "richmenu-d003829b8b0e855887e6b0d16d13b01e";
const VOLUNTEER_MENU_ID = "richmenu-4c00a8ef07910382924ce46b4b1f2d77";

async function syncRichMenu(userId) {
  try {
    const [users] = await db.query("SELECT role, status FROM users WHERE line_user_id=?", [userId]);
    if (!users.length) return;
    const { role, status } = users[0];
    const menuId = role === "volunteer" && status === "approved" ? VOLUNTEER_MENU_ID : ELDER_MENU_ID;
    try { await client.unlinkRichMenuFromUser(userId); } catch (e) {}
    await client.linkRichMenuToUser(userId, menuId);
    console.log(`✅ Rich Menu: role=${role}, status=${status} → ${menuId}`);
  } catch (err) {
    console.log("❌ syncRichMenu error:", err.response?.data || err.message);
  }
}

module.exports = { syncRichMenu };