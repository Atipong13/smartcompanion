const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();
const RICHMENU_ID = "richmenu-469b972fa29fcd8f5402c54cb41b743b";

axios.get(
  `https://api-data.line.me/v2/bot/richmenu/${RICHMENU_ID}/content`,
  {
    headers: {
      Authorization: `Bearer ${TOKEN}`
    },
    responseType: "arraybuffer"
  }
)
.then(res => {
  console.log("✅ มีรูปอยู่");
  console.log("Size:", res.data.length);
})
.catch(err => {
  console.log("❌", err.response?.status);
  console.log(err.response?.data?.toString());
});