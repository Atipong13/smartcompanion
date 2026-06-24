require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

async function createRichMenu() {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/richmenu",
      {
        size: {
          width: 2500,
          height: 1686
        },
        selected: false,
        name: "ElderMenu",
        chatBarText: "เมนูผู้สูงอายุ",
        areas: [
          {
            bounds: {
              x: 0,
              y: 0,
              width: 2500,
              height: 1686
            },
            action: {
              type: "message",
              text: "ขอความช่วยเหลือ"
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ CREATED ELDER MENU ID:", res.data.richMenuId);
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

createRichMenu();
///✅ CREATED ELDER MENU ID: richmenu-ce37488d04cbd147cfa0210e47c959f2///