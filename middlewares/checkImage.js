const axios = require("axios");
require("dotenv").config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN.trim();

const menus = {
  ELDER_MENU_ID:     "richmenu-d003829b8b0e855887e6b0d16d13b01e",
  VOLUNTEER_MENU_ID: "richmenu-4c00a8ef07910382924ce46b4b1f2d77"
};

(async () => {
  for (const [name, id] of Object.entries(menus)) {
    try {
      const res = await axios.get(
        `https://api-data.line.me/v2/bot/richmenu/${id}/content`,
        {
          headers: { Authorization: `Bearer ${TOKEN}` },
          responseType: "arraybuffer"
        }
      );
      console.log(`✅ ${name} (${id}) มีรูปอยู่ | Size:`, res.data.length);
    } catch (err) {
      console.log(`❌ ${name} (${id}) ERROR:`, err.response?.status);
      console.log(err.response?.data?.toString());
    }
  }
})();