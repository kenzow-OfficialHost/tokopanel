/**
 * Komerce QRISLY API Client
 * Dokumentasi resmi: https://rajaongkir.com/docs/qrisly/getting-started/flow-overview-page
 *
 * Menggantikan generateDynamicQris() versi manual (utils/qris.js) dengan
 * pemanggilan API resmi Komerce, supaya:
 *  - Nominal & QRIS tercatat di sisi Komerce (history_id)
 *  - Bisa dicek statusnya kapan saja (GET payment-status/{history_id})
 *  - Bisa menerima notifikasi otomatis via webhook saat pembayaran masuk
 *
 * ENV yang dibutuhkan (isi di .env / Vercel Environment Variables):
 *  QRISLY_API_KEY   -> dari Developer > API Key > QRISLY API di dashboard Komerce
 *  QRISLY_QRIS_ID   -> id QRIS yang sudah diupload di menu Payment API > QRISLY
 *                      (lihat kolom "qris_id" hasil upload, BUKAN nama tampilannya)
 *  QRISLY_BASE_URL  -> https://api-sandbox.collaborator.komerce.id/user/api/v1/qrisly
 *                      (ganti ke base URL production kalau akun sudah "Go Live")
 */

const fetch = require("node-fetch");

const BASE_URL = process.env.QRISLY_BASE_URL || "https://api-sandbox.collaborator.komerce.id/user/api/v1/qrisly";

function getApiKey() {
  const key = process.env.QRISLY_API_KEY;
  if (!key) throw Object.assign(new Error("QRISLY_API_KEY belum diisi di .env"), { status: 500 });
  return key;
}

function getQrisId() {
  const id = process.env.QRISLY_QRIS_ID;
  if (!id) throw Object.assign(new Error("QRISLY_QRIS_ID belum diisi di .env"), { status: 500 });
  const numId = Number(id);
  if (Number.isNaN(numId)) {
    throw Object.assign(new Error(`QRISLY_QRIS_ID harus berupa angka, sekarang isinya: "${id}"`), { status: 500 });
  }
  return numId;
}

async function generateQris(amount) {
  const res = await fetch(`${BASE_URL}/generate-qris`, {
    method: "POST",
    headers: {
      "x-api-key": getApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      qris_id: getQrisId(),
      amount: Math.round(amount),
      output_type: "string",
    }),
  });

  const raw = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error("[QRISLY generate-qris] HTTP", res.status, "response:", JSON.stringify(raw));
    throw Object.assign(
      new Error(raw.message || raw.error || `QRISLY generate-qris gagal (HTTP ${res.status})`),
      { status: 502 }
    );
  }

  const data = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" ? raw.data : raw;

  if (!data.qris_string || data.history_id === undefined || data.history_id === null) {
    console.error("[QRISLY generate-qris] Response tidak sesuai format yang diharapkan:", JSON.stringify(raw));
    throw Object.assign(
      new Error("Response QRISLY generate-qris tidak berisi qris_string/history_id yang diharapkan (cek Vercel Logs untuk raw response)"),
      { status: 502 }
    );
  }

  return data;
}

async function getPaymentStatus(historyId) {
  const res = await fetch(`${BASE_URL}/payment-status/${historyId}`, {
    method: "GET",
    headers: { "x-api-key": getApiKey() },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw Object.assign(
      new Error(data.message || data.error || `QRISLY payment-status gagal (HTTP ${res.status})`),
      { status: 502 }
    );
  }

  return data;
}

module.exports = { generateQris, getPaymentStatus };
