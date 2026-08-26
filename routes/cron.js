const express = require("express");
const { runExpiryCheck } = require("../utils/expiryJob");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Dipanggil otomatis oleh Vercel Cron (lihat "crons" di vercel.json).
// Vercel otomatis mengirim header `Authorization: Bearer <CRON_SECRET>`
// kalau env CRON_SECRET diisi di Project Settings -> Environment Variables,
// jadi endpoint ini aman dari orang luar yang iseng manggil manual.
router.get(
  "/expiry-check",
  asyncHandler(async (req, res) => {
    if (process.env.CRON_SECRET) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    const result = await runExpiryCheck();
    res.json({ success: true, ...result });
  })
);

module.exports = router;
