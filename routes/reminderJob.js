const db = require("../config/db");
const line = require("@line/bot-sdk");

const client = new line.Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

async function checkReminders() {
    const [rows] = await db.query(
        "SELECT * FROM reminders WHERE status = 'pending' AND reminder_time <= NOW()"
    );

    for (let reminder of rows) {

        await client.pushMessage(reminder.elder_id, {
            type: "template",
            altText: "แจ้งเตือนกินยา",
            template: {
                type: "buttons",
                text: `ถึงเวลากินยา: ${reminder.title}`,
                actions: [
                    {
                        type: "postback",
                        label: "รับทราบแล้ว",
                        data: `ack_${reminder.id}`
                    }
                ]
            }
        });

        await db.query(
            "UPDATE reminders SET last_sent_at = NOW() WHERE id = ?",
            [reminder.id]
        );
    }
}

module.exports = checkReminders;