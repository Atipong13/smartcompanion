require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.LINE_CHANNEL_TOKEN;

async function createMenu() {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/richmenu",
      {
        size: { width: 2500, height: 1686 },
        selected: false,
        name: "VolunteerMenu",
        chatBarText: "เมนูอาสา",
        areas: [
          {
            bounds: { x: 0, y: 0, width: 2500, height: 1686 },
            action: {
              type: "message",
              text: "ดูประวัติ"
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN.trim()}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ VOLUNTEER MENU ID:", res.data.richMenuId);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

createMenu();