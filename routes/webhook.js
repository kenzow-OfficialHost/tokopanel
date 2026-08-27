const express = require("express");
const db = require("../config/db");
const { verifyAndProvision } = require("./admin");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Webhook resmi Komerce QRISLY. Daftarkan URL ini di dashboard Komerce:
// Developer > Webhook, isi dengan: https://DOMAIN_KAMU/api/webhook/qrisly
//
// Format payload sesuai dokumentasi resmi
// (https://rajaongkir.com/docs/qrisly/getting-started/flow-overview-page):
// {
//   "qris_history_id": 1771,
//   "transaction_id": "TEST-177251866516",
//   "payment_status": "paid",
//   "amount": 1001,
//   "paid_amount": 1001,
//   "paid_at": "2026-03-03 13:17:47",
//   "expired_at": "2026-03-03 13:22:22"
// }
//
// CATATAN KEAMANAN: dokumentasi publik Komerce yang saya baca belum
// menyebutkan mekanisme signature/secret khusus untuk webhook QRISLY (beda
// dengan provider lain yang biasanya kirim header X-Signature). Cek menu
// "Developer > Webhook" di dashboard Komerce — kalau di sana ada opsi isi
// "Webhook Secret"/token, WAJIB diisi dan divalidasi di sini juga (tambahkan
// pengecekan header, sama seperti pola /qris-paid versi lama di bawah).
// Selama belum ada mekanisme itu, endpoint ini tervalidasi lewat:
//   1) qris_history_id harus cocok dengan order yang benar-benar ada di DB kita
//   2) amount dari webhook harus sama dengan qrisly_final_amount yang kita catat
//      sendiri saat generate-qris (jadi nggak bisa asal tembak nilai acak)
router.post(
  "/qrisly",
  express.json(),
  asyncHandler(async (req, res) => {
    const { qris_history_id, payment_status, amount, paid_amount } = req.body;

    if (!qris_history_id) {
      return res.status(400).json({ error: "qris_history_id tidak ada di payload" });
    }

    const order = await db.prepare("SELECT * FROM orders WHERE qrisly_history_id = ?").get(String(qris_history_id));
    if (!order) {
      // Tetap balas 200 supaya Komerce tidak retry terus untuk history_id yang
      // memang bukan urusan sistem kita, tapi catat di log untuk investigasi.
      console.warn(`[webhook:qrisly] history_id ${qris_history_id} tidak ditemukan di DB`);
      return res.status(200).json({ received: true, matched: false });
    }

    const paidAmount = Number(paid_amount ?? amount);
    if (order.qrisly_final_amount && paidAmount !== Number(order.qrisly_final_amount)) {
      console.warn(
        `[webhook:qrisly] Nominal tidak cocok untuk order ${order.id}: expected ${order.qrisly_final_amount}, got ${paidAmount}`
      );
      await db.prepare("UPDATE orders SET qrisly_status = ? WHERE id = ?").run(payment_status || "mismatch", order.id);
      return res.status(200).json({ received: true, matched: false, reason: "amount_mismatch" });
    }

    await db.prepare("UPDATE orders SET qrisly_status = ? WHERE id = ?").run(payment_status || "unknown", order.id);

    if (payment_status !== "paid") {
      // Event selain "paid" (misal masih "unpaid"/expired) cukup dicatat statusnya saja.
      return res.status(200).json({ received: true, matched: true, provisioned: false });
    }

    if (order.status === "paid") {
      // Sudah pernah diproses sebelumnya (retry webhook) - jangan provision dobel.
      return res.status(200).json({ received: true, already_paid: true });
    }

    try {
      const result = await verifyAndProvision(order.id);
      res.status(200).json({ received: true, matched: true, provisioned: !result.manual });
    } catch (e) {
      // Tetap balas 200 ke Komerce (pembayarannya valid), tapi log error provisioning
      // supaya admin bisa proses manual dari dashboard admin kalau auto-provision gagal.
      console.error(`[webhook:qrisly] Gagal provisioning order ${order.id}:`, e);
      res.status(200).json({ received: true, matched: true, provisioned: false, error: e.message });
    }
  })
);

// --- LEGACY: endpoint manual lama, dibiarkan aktif untuk backward-compat ---
// kalau kamu masih pernah pakai ini untuk trigger manual/testing lewat curl/Postman.
router.post(
  "/qris-paid",
  express.json(),
  asyncHandler(async (req, res) => {
    try {
      const { invoice_code, amount, secret } = req.body;

      if (secret !== process.env.WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Secret tidak valid" });
      }

      const order = await db.prepare("SELECT * FROM orders WHERE invoice_code = ?").get(invoice_code);
      if (!order) return res.status(404).json({ error: "Invoice tidak ditemukan" });
      if (Number(order.amount) !== Number(amount)) {
        return res.status(400).json({ error: "Nominal tidak cocok, kemungkinan salah bayar" });
      }

      const { server } = await verifyAndProvision(order.id);
      res.json({ success: true, ptero_server_id: server.id });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  })
);

module.exports = router;
