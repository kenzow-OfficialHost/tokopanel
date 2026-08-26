const express = require("express");
const db = require("../config/db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { ensurePteroUser, createServer, resetPteroPassword, deleteServer } = require("../utils/pterodactyl");
const { runExpiryCheck } = require("../utils/expiryJob");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get(
  "/stats/revenue",
  asyncHandler(async (req, res) => {
    const yearly = await db
      .prepare(
        `SELECT strftime('%Y', paid_at) as year, SUM(amount) as total, COUNT(*) as count
         FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL
         GROUP BY year ORDER BY year DESC`
      )
      .all();

    const monthly = await db
      .prepare(
        `SELECT strftime('%Y', paid_at) as year, strftime('%m', paid_at) as month, SUM(amount) as total, COUNT(*) as count
         FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL
         GROUP BY year, month ORDER BY year DESC, month DESC`
      )
      .all();

    res.json({ yearly, monthly });
  })
);

router.get(
  "/orders",
  asyncHandler(async (req, res) => {
    const orders = await db
      .prepare(
        `SELECT o.*, p.name as package_name, p.ram_mb, p.disk_mb, p.cpu_percent, p.databases, p.backups,
                u.name as user_name, u.email as user_email
         FROM orders o
         JOIN packages p ON p.id = o.package_id
         JOIN users u ON u.id = o.user_id
         ORDER BY o.created_at DESC`
      )
      .all();
    res.json({ orders });
  })
);

// URL panel & kolom user id di tabel `users` beda-beda tergantung brand
// (Pterodactyl / Pyrodactyl / Private Server), supaya kredensial buyer bisa
// dipetakan balik ke akun panel yang benar.
function panelUrlFor(category) {
  if (category === "pyrodactyl") return process.env.PYRO_PANEL_URL;
  if (category === "private") return process.env.PRIVATE_PANEL_URL;
  return process.env.PTERO_PANEL_URL;
}
function userIdFieldFor(category) {
  if (category === "pyrodactyl") return "pyro_user_id";
  if (category === "private") return "private_user_id";
  return "ptero_user_id";
}

function addDuration(duration) {
  const ms = duration === "monthly" ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function verifyAndProvision(orderId) {
  const order = await db
    .prepare(
      `SELECT o.*, p.ram_mb, p.disk_mb, p.cpu_percent, p.databases, p.backups,
              u.name as user_name, u.email as user_email
       FROM orders o
       JOIN packages p ON p.id = o.package_id
       JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`
    )
    .get(orderId);

  if (!order) throw Object.assign(new Error("Order tidak ditemukan"), { status: 404 });
  if (order.status === "paid") throw Object.assign(new Error("Order sudah diverifikasi sebelumnya"), { status: 400 });

  const activeUntil = addDuration(order.duration);

  // Kategori "admin_panel" TIDAK auto-provision lewat API — butuh setup infra manual
  // (VPS/panel baru), jadi cuma ditandai paid + dikasih catatan buat kamu proses manual.
  if (order.category === "admin_panel") {
    await db
      .prepare(`UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP, active_until=?, admin_note=? WHERE id=?`)
      .run(activeUntil, "Perlu setup manual: siapkan VPS/panel sesuai spek & kirim akses ke buyer.", order.id);
    return { manual: true, order };
  }

  const pteroUser = await ensurePteroUser({ category: order.category, email: order.user_email, name: order.user_name });
  const server = await createServer({
    category: order.category,
    eggChoice: order.egg_choice,
    pteroUserId: pteroUser.id,
    serverName: order.server_name,
    ramMb: order.ram_mb,
    diskMb: order.disk_mb,
    cpuPercent: order.cpu_percent,
    dbCount: order.databases,
    backupCount: order.backups,
  });

  const panelUrl = panelUrlFor(order.category);

  // Buyer WAJIB dapat username & password yang jelas dan pasti bisa dipakai,
  // gak boleh disuruh nebak. Kalau akun panelnya baru dibuat, password random
  // dari ensurePteroUser sudah pasti valid. Tapi kalau akun sudah ada sebelumnya
  // (dipakai ulang, generated_password kosong), password lama itu TIDAK diketahui
  // sistem — jadi di sini kita paksa reset ke password baru yang random supaya
  // tetap bisa ditampilkan jelas ke buyer, bukan disuruh "pakai password lama".
  let finalUsername = pteroUser.username;
  let finalPassword = pteroUser.generated_password;
  if (!finalPassword) {
    const reset = await resetPteroPassword(order.category, pteroUser.id);
    finalUsername = reset.username;
    finalPassword = reset.password;
  }

  await db
    .prepare(
      `UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP, active_until=?, ptero_server_id=?,
       panel_username=?, panel_password=?, panel_url=? WHERE id=?`
    )
    .run(activeUntil, server.id, finalUsername, finalPassword, panelUrl, order.id);

  const userIdField = userIdFieldFor(order.category);
  await db.prepare(`UPDATE users SET ${userIdField}=? WHERE id=?`).run(pteroUser.id, order.user_id);

  return { manual: false, server, username: finalUsername, password: finalPassword, panelUrl };
}

router.post(
  "/orders/:id/verify",
  asyncHandler(async (req, res) => {
    try {
      const result = await verifyAndProvision(req.params.id);
      if (result.manual) {
        return res.json({
          success: true,
          message: "Order Admin Panel Server ditandai lunas. Silakan setup manual & kirim akses ke buyer.",
        });
      }
      res.json({
        success: true,
        message: "Pembayaran diverifikasi & server berhasil dibuat",
        ptero_server_id: result.server.id,
        panel_url: result.panelUrl,
        panel_username: result.username,
        panel_password: result.password,
      });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  })
);

router.post(
  "/orders/:id/reject",
  asyncHandler(async (req, res) => {
    await db.prepare(`UPDATE orders SET status='cancelled' WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  })
);

// Admin bisa membatalkan pesanan APAPUN statusnya (pending maupun paid).
// Kalau pesanan sudah "paid" dan sudah punya server di panel, server-nya
// ikut dihapus otomatis supaya resource tidak nyangkut/oversell diam-diam.
router.post(
  "/orders/:id/cancel",
  asyncHandler(async (req, res) => {
    try {
      const order = await db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
      if (!order) return res.status(404).json({ error: "Pesanan tidak ditemukan" });
      if (["cancelled", "expired"].includes(order.status)) {
        return res.status(400).json({ error: "Pesanan ini sudah tidak aktif" });
      }

      let serverDeleted = false;
      if (order.status === "paid" && order.category !== "admin_panel" && order.ptero_server_id) {
        try {
          await deleteServer(order.category, order.ptero_server_id);
          serverDeleted = true;
        } catch (e) {
          console.error(`[admin cancel] Gagal hapus server order #${order.id}:`, e.message);
        }
      }

      await db
        .prepare(`UPDATE orders SET status='cancelled', admin_note=? WHERE id=?`)
        .run(
          order.status === "paid"
            ? `Dibatalkan admin.${serverDeleted ? " Server di panel sudah dihapus." : order.category === "admin_panel" ? " Admin Panel/VPS perlu dinonaktifkan manual." : ""}`
            : "Dibatalkan admin.",
          order.id
        );

      res.json({ success: true, server_deleted: serverDeleted });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  })
);

// Trigger manual pengecekan masa aktif (biasanya sudah jalan otomatis lewat
// Vercel Cron, ini buat jaga-jaga/dites manual dari admin).
router.post(
  "/orders/check-expired",
  asyncHandler(async (req, res) => {
    try {
      const result = await runExpiryCheck();
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  })
);

// Buat order LAMA yang sudah "paid" tapi belum punya kredensial tersimpan
// (diverifikasi sebelum fitur ini ada). Ambil username asli dari panel +
// reset password baru, simpan ke order supaya muncul di dashboard buyer.
router.post(
  "/orders/:id/fetch-credentials",
  asyncHandler(async (req, res) => {
    try {
      const order = await db
        .prepare(
          `SELECT o.*, u.email as user_email, u.name as user_name
           FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
        )
        .get(req.params.id);

      if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
      if (order.status !== "paid") return res.status(400).json({ error: "Order belum lunas" });
      if (order.category === "admin_panel") return res.status(400).json({ error: "Kategori ini tidak pakai kredensial panel" });

      const pteroUser = await ensurePteroUser({ category: order.category, email: order.user_email, name: order.user_name });
      const { username, password } = await resetPteroPassword(order.category, pteroUser.id);
      const panelUrl = panelUrlFor(order.category);

      await db
        .prepare(`UPDATE orders SET panel_username=?, panel_password=?, panel_url=? WHERE id=?`)
        .run(username, password, panelUrl, order.id);

      res.json({ success: true, username, password });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  })
);

module.exports = router;
module.exports.verifyAndProvision = verifyAndProvision;
