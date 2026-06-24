require("dotenv").config();
const axios = require("axios");

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

async function getRichMenu() {
  try {
    const res = await axios.get(
      "https://api.line.me/v2/bot/richmenu/list",
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`
        }
      }
    );

    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

getRichMenu();