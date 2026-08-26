require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");

require("./config/db"); // modul DB (Turso/libSQL) - schema di-init lazy saat query pertama

const authRoutes = require("./routes/auth");
const packageRoutes = require("./routes/packages");
const orderRoutes = require("./routes/orders");
const adminRoutes = require("./routes/admin");
const webhookRoutes = require("./routes/webhook");
const cronRoutes = require("./routes/cron");
const { startExpiryScheduler } = require("./utils/expiryJob");

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/cron", cronRoutes);

app.use(express.static(path.join(__dirname, "public")));

// Fallback semua route non-api ke 404.html (multi-page biasa, bukan SPA)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "404.html"), (err) => {
    if (err) res.status(404).send("Halaman tidak ditemukan");
  });
});

// Error handler generik - supaya kalau ada Promise reject (query DB gagal,
// dsb) request tetap dapat respons JSON, bukan hang tanpa balasan.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || "Terjadi kesalahan pada server" });
});

// PENTING (Vercel): file ini di-import Vercel sebagai serverless function
// lewat `module.exports = app`, BUKAN dijalankan langsung -> app.listen()
// tidak pernah dipanggil di Vercel, jadi tidak konflik dengan port yang
// dikelola Vercel sendiri. Blok di bawah ini cuma aktif kalau kamu jalankan
// manual (`node server.js` / `npm start`), misal masih mau coba lokal atau
// tetap ingin hosting sebagian di VPS.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`MarketPanelServer jalan di http://localhost:${PORT}`);
    console.log(`Domain produksi: ${process.env.DOMAIN}`);
    startExpiryScheduler();
  });
}

module.exports = app;
