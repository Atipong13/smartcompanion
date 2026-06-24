const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();
const RICHMENU_ID = "richmenu-469b972fa29fcd8f5402c54cb41b743b";

axios.delete(
  `https://api-data.line.me/v2/bot/richmenu/${RICHMENU_ID}/content`,
  {
    headers: {
      Authorization: `Bearer ${TOKEN}`
    }
  }
)
.then(() => console.log("✅ ลบรูปสำเร็จ"))
.catch(err => {
  console.log("❌", err.response?.status);
  console.log(err.response?.data);
});