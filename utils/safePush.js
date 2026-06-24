// utils/safePush.js
let _client = null;

const init = (client) => { _client = client; };

const safePush = async (userId, messages) => {
  if (!userId || !_client) return;
  for (let i = 0; i < 3; i++) {
    try {
      await _client.pushMessage(userId, messages);
      return;
    } catch (err) {
      const status = err.response?.status || err.statusCode;
      if (status === 429 && i < 2) {
        console.log(`⚠️ Rate limit (ครั้งที่ ${i + 1}), รอ ${(i + 1) * 2} วิ...`);
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
      } else {
        console.log("❌ Push Error:", err.response?.data || err.message);
        return;
      }
    }
  }
};

module.exports = { init, safePush };