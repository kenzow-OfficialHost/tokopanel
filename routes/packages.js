const express = require("express");
const db = require("../config/db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Publik: semua paket aktif, dikelompokkan per kategori
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rawRows = await db
      .prepare("SELECT * FROM packages WHERE is_active = 1 ORDER BY category, sort_order ASC")
      .all();
    const rows = rawRows.map((p) => ({
      ...p,
      allowed_eggs: p.allowed_eggs ? JSON.parse(p.allowed_eggs) : null,
      benefits: p.benefits ? JSON.parse(p.benefits) : [],
    }));

    const grouped = { pterodactyl: [], pyrodactyl: [], admin_panel: [], private: [] };
    for (const p of rows) {
      if (grouped[p.category]) grouped[p.category].push(p);
    }
    res.json({ packages: grouped });
  })
);

router.post(
  "/",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { category, name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs, badge, benefits } = req.body;
    const info = await db
      .prepare(
        `INSERT INTO packages (category, name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs, badge, benefits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(category, name, ram_mb, disk_mb, cpu_percent, databases || 0, backups || 0, price_weekly, price_monthly, allowed_eggs ? JSON.stringify(allowed_eggs) : null, badge || null, benefits ? JSON.stringify(benefits) : null);
    res.json({ success: true, id: info.lastInsertRowid });
  })
);

router.put(
  "/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs, badge, benefits, is_active } = req.body;
    await db
      .prepare(
        `UPDATE packages SET name=?, ram_mb=?, disk_mb=?, cpu_percent=?, databases=?, backups=?, price_weekly=?, price_monthly=?, allowed_eggs=?, badge=?, benefits=?, is_active=?
         WHERE id=?`
      )
      .run(name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs ? JSON.stringify(allowed_eggs) : null, badge || null, benefits ? JSON.stringify(benefits) : null, is_active, req.params.id);
    res.json({ success: true });
  })
);

module.exports = router;
