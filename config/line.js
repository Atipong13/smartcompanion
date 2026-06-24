const line = require("@line/bot-sdk");

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

module.exports = client;