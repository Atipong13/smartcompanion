const express = require("express");
const router = express.Router();
const db = require("../config/db");

router.get("/elder", (req, res) => {
  if (!req.session.user) return res.redirect("/");
  res.render("elder", { name: req.session.user });
});

router.post("/request-help", (req, res) => {
  const detail = req.body.detail;
  const elder_name = req.session.user;

  db.query(
    "INSERT INTO help_requests (elder_name, detail, status) VALUES (?,?,?)",
    [elder_name, detail, "waiting"],
    () => {
      res.redirect("/elder");
    }
  );
});

module.exports = router;