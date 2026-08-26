const express = require("express");
const QRCode = require("qrcode");
const db = require("../config/db");
const { requireAuth } = require("../middleware/auth");
const { generateDynamicQris } = require("../utils/qris");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

function genInvoiceCode() {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TKP-${Date.now().toString().slice(-6)}${rand}`;
}

// Kategori yang butuh buyer memilih egg (minecraft/whatsapp) saat checkout.
// "private" tidak butuh pilihan egg dari buyer karena nest/egg-nya sudah
// dikonfigurasi tetap oleh admin lewat .env (server privat custom).
const NEEDS_EGG_CHOICE = ["pterodactyl", "pyrodactyl"];

// --- Promo "Pengguna Baru" ---
// Paket Unlimited (Pterodactyl/Pyrodactyl) durasi bulanan dapat harga spesial
// Rp5.000 KHUSUS untuk buyer yang belum pernah punya order "paid" sama sekali
// (checkout pertama). Setelah sekali pakai promo ini (order berhasil), harga
// buyer itu balik normal ke harga paket biasa (Rp10.000/bulan) selamanya.
const NEW_USER_PROMO_PRICE = 5000;
const NEW_USER_PROMO_CATEGORIES = ["pterodactyl", "pyrodactyl"];

async function isNewUser(userId) {
  const row = await db.prepare("SELECT COUNT(*) as c FROM orders WHERE user_id = ? AND status = 'paid'").get(userId);
  return row.c === 0;
}

function isPromoEligiblePackage(pkg, duration) {
  return (
    NEW_USER_PROMO_CATEGORIES.includes(pkg.category) &&
    pkg.name === "Unlimited" &&
    duration === "monthly"
  );
}

// Endpoint buat frontend cek dulu: buyer ini masih dianggap "pengguna baru"
// (berhak dapat promo) atau tidak, sebelum checkout beneran dilakukan.
router.get(
  "/promo-status",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ new_user: await isNewUser(req.user.id) });
  })
);

router.post(
  "/checkout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { package_id, duration, egg_choice, server_name } = req.body;

    const pkg = await db.prepare("SELECT * FROM packages WHERE id = ? AND is_active = 1").get(package_id);
    if (!pkg) return res.status(404).json({ error: "Paket tidak ditemukan" });

    if (!["weekly", "monthly"].includes(duration)) {
      return res.status(400).json({ error: "Durasi harus 'weekly' atau 'monthly'" });
    }

    const isAdminPanel = pkg.category === "admin_panel";
    const needsEgg = NEEDS_EGG_CHOICE.includes(pkg.category);

    if (needsEgg) {
      const allowedEggs = pkg.allowed_eggs ? JSON.parse(pkg.allowed_eggs) : [];
      if (!allowedEggs.includes(egg_choice)) {
        return res.status(400).json({ error: "Pilihan egg tidak valid untuk paket ini" });
      }
    }
    if (!isAdminPanel) {
      if (!server_name || server_name.trim().length < 3) {
        return res.status(400).json({ error: "Nama server minimal 3 karakter" });
      }
    }

    let price = duration === "monthly" ? pkg.price_monthly : pkg.price_weekly;
    let usedPromo = false;
    if (isPromoEligiblePackage(pkg, duration) && (await isNewUser(req.user.id))) {
      price = NEW_USER_PROMO_PRICE;
      usedPromo = true;
    }

    const staticQris = process.env.QRIS_STATIC_STRING;
    if (!staticQris) {
      return res.status(500).json({ error: "QRIS_STATIC_STRING belum diisi admin di .env" });
    }

    let dynamicPayload;
    try {
      dynamicPayload = generateDynamicQris(staticQris, price);
    } catch (e) {
      return res.status(500).json({ error: "Gagal generate QRIS: " + e.message });
    }

    const invoice = genInvoiceCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const info = await db
      .prepare(
        `INSERT INTO orders (invoice_code, user_id, package_id, category, duration, egg_choice, amount, server_name, qris_payload, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        invoice,
        req.user.id,
        pkg.id,
        pkg.category,
        duration,
        needsEgg ? egg_choice : null,
        price,
        isAdminPanel ? `Admin Panel - ${req.user.name}` : server_name.trim(),
        dynamicPayload,
        expiresAt
      );

    res.json({
      success: true,
      order_id: info.lastInsertRowid,
      invoice_code: invoice,
      amount: price,
      expires_at: expiresAt,
    });
  })
);

router.get(
  "/:id/qr",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    try {
      const dataUrl = await QRCode.toDataURL(order.qris_payload, { width: 320, margin: 1 });
      res.json({ qr_image: dataUrl, amount: order.amount, status: order.status, expires_at: order.expires_at });
    } catch (e) {
      res.status(500).json({ error: "Gagal render QR: " + e.message });
    }
  })
);

router.get(
  "/:id/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await db
      .prepare("SELECT id, status, invoice_code, ptero_server_id, active_until FROM orders WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json({ order });
  })
);

// User boleh membatalkan pesanan MILIKNYA SENDIRI selama masih berstatus
// "pending" (belum diverifikasi admin / belum dibayar). Untuk pesanan yang
// sudah "paid" (server sudah dibuat), pembatalan harus lewat admin karena
// perlu proses hapus server di panel juga.
router.post(
  "/:id/cancel",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan" });

    if (order.status !== "pending") {
      return res.status(400).json({
        error:
          order.status === "paid"
            ? "Pesanan ini sudah aktif/lunas, hubungi admin lewat WhatsApp kalau ingin membatalkannya."
            : "Pesanan ini sudah tidak bisa dibatalkan.",
      });
    }

    await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
    res.json({ success: true });
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const orders = await db
      .prepare(
        `SELECT o.*, p.name as package_name, p.ram_mb, p.disk_mb, p.cpu_percent, p.databases, p.backups
         FROM orders o
         JOIN packages p ON p.id = o.package_id
         WHERE o.user_id = ? ORDER BY o.created_at DESC`
      )
      .all(req.user.id);
    res.json({ orders });
  })
);

module.exports = router;
