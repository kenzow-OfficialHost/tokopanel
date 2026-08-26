const db = require("../config/db");
const { deleteServer } = require("./pterodactyl");

/**
 * Cek semua order berstatus "paid" yang masa aktifnya (active_until) sudah lewat,
 * lalu benar-benar menghapus server di panel (Pterodactyl/Pyrodactyl) dan
 * mengubah status order jadi "expired". Ini yang bikin fitur "masa aktif"
 * nyata (bukan cuma label doang) — paket mingguan otomatis kehapus setelah
 * 7 hari, paket bulanan setelah 30 hari, dst sesuai active_until di DB.
 *
 * Kategori "admin_panel" tidak auto-delete lewat API (infra-nya manual/VPS
 * terpisah), jadi cuma ditandai expired + dikasih catatan supaya admin proses
 * manual (matikan VPS / cabut akses).
 */
async function runExpiryCheck() {
  const now = new Date().toISOString();
  const expiredOrders = await db
    .prepare(`SELECT * FROM orders WHERE status = 'paid' AND active_until IS NOT NULL AND active_until <= ?`)
    .all(now);

  let processed = 0;
  let failed = 0;

  for (const order of expiredOrders) {
    try {
      if (order.category !== "admin_panel" && order.ptero_server_id) {
        await deleteServer(order.category, order.ptero_server_id);
      }

      await db.prepare(`UPDATE orders SET status = 'expired', admin_note = ? WHERE id = ?`).run(
        order.category === "admin_panel"
          ? "Masa aktif habis. Admin Panel Server (VPS) perlu dinonaktifkan/diproses manual oleh admin."
          : "Masa aktif habis, server otomatis dihapus dari panel.",
        order.id
      );

      console.log(`[expiry] Order #${order.id} (${order.invoice_code}) ditandai kedaluwarsa.`);
      processed++;
    } catch (e) {
      failed++;
      console.error(`[expiry] Gagal proses order #${order.id} (${order.invoice_code}):`, e.message);
      // Tetap simpan catatan biar admin tahu ada yang gagal auto-hapus, tanpa
      // mengubah status supaya job berikutnya coba lagi.
      await db.prepare(`UPDATE orders SET admin_note = ? WHERE id = ?`).run(
        `Masa aktif sudah habis tapi gagal auto-hapus server: ${e.message}. Perlu dicek manual.`,
        order.id
      );
    }
  }

  return { checked: expiredOrders.length, processed, failed };
}

// ==== CATATAN PENTING (perubahan dari versi VPS) ====
// Versi lama pakai setInterval() supaya pengecekan jalan otomatis tiap
// beberapa menit selama proses Node hidup terus. Di Vercel, proses TIDAK
// hidup terus (serverless -> mati lagi setelah tiap request), jadi
// setInterval/setTimeout semacam ini TIDAK AKAN JALAN.
//
// Sebagai gantinya, pengecekan dijadwalkan lewat Vercel Cron Jobs yang
// memanggil endpoint GET /api/cron/expiry-check (lihat routes/cron.js &
// vercel.json). Kalau butuh cek lebih sering dari jadwal cron, gunakan
// tombol "Cek Sekarang" di admin.html (memanggil POST /api/admin/orders/check-expired)
// atau upgrade ke Vercel Pro untuk jadwal cron yang lebih rapat.
//
// startExpiryScheduler() di bawah ini TETAP disediakan untuk kasus kamu suatu
// saat menjalankan project ini di VPS biasa (`node server.js` terus-menerus),
// bukan di Vercel — server.js hanya memanggilnya kalau dijalankan langsung.
function startExpiryScheduler() {
  const intervalMs = Number(process.env.EXPIRY_CHECK_INTERVAL_MS) || 5 * 60 * 1000;

  setTimeout(() => {
    runExpiryCheck().catch((e) => console.error("[expiry] Gagal jalankan pengecekan awal:", e.message));
  }, 15 * 1000);

  setInterval(() => {
    runExpiryCheck().catch((e) => console.error("[expiry] Gagal jalankan pengecekan berkala:", e.message));
  }, intervalMs);

  console.log(`[expiry] Scheduler aktif, cek tiap ${Math.round(intervalMs / 60000)} menit.`);
}

module.exports = { runExpiryCheck, startExpiryScheduler };
