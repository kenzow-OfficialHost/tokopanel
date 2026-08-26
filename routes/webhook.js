const express = require("express");
const db = require("../config/db");
const { verifyAndProvision } = require("./admin");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Endpoint ini BELUM aktif dipakai — siap dipasang kalau nanti kamu
// langganan layanan cek mutasi QRIS otomatis (contoh: OkeConnect, Tripay,
// Midtrans, dsb). Provider tsb akan POST ke sini setiap ada uang masuk.
//
// PENTING sebelum dipakai di production:
// 1. Tambahkan validasi signature/token rahasia dari provider (jangan biarkan
//    endpoint ini bisa dipanggil sembarang orang).
// 2. Sesuaikan nama field body sesuai dokumentasi provider yang kamu pakai.
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
