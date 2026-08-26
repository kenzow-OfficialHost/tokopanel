const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: "Data tidak lengkap / password minimal 6 karakter" });
    }
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) return res.status(400).json({ error: "Email sudah terdaftar" });

    const hash = bcrypt.hashSync(password, 10);
    const info = await db
      .prepare("INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)")
      .run(name, email, phone || null, hash);

    const token = jwt.sign(
      { id: info.lastInsertRowid, name, email, role: "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
    res.json({ success: true, token });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Email atau password salah" });
    }
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.cookie("token", token, { httpOnly: true, sameSite: "lax" });
    res.json({ success: true, token, role: user.role });
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db
      .prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?")
      .get(req.user.id);
    res.json({ user });
  })
);

module.exports = router;
