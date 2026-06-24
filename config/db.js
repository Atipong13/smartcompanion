const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "12345678",
  database: "smartcompanion",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = db;