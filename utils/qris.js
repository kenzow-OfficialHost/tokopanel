/**
 * QRIS EMV Co-Standard Utility
 * Fungsi: inject nominal transaksi ke QRIS statis, ubah jadi "dinamis" per-transaksi,
 * lalu hitung ulang CRC16-CCITT (tag 63) sesuai spesifikasi QRIS/EMVCo.
 *
 * Format umum TLV: [TAG(2 digit)][LENGTH(2 digit)][VALUE]
 */

function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildTLV(tag, value) {
  const length = value.length.toString().padStart(2, "0");
  return `${tag}${length}${value}`;
}

/**
 * Parse string EMV QR jadi list segment {tag, length, value}
 */
function parseTags(qrString) {
  const tags = [];
  let i = 0;
  while (i < qrString.length - 4) {
    // -4 supaya CRC (tag 63) di akhir tidak ikut ke-parse sebagai isi
    const tag = qrString.substring(i, i + 2);
    const len = parseInt(qrString.substring(i + 2, i + 4), 10);
    const value = qrString.substring(i + 4, i + 4 + len);
    tags.push({ tag, value });
    i += 4 + len;
  }
  return tags;
}

/**
 * Ambil nominal (integer, rupiah tanpa desimal) dan static QRIS string,
 * hasilkan string QRIS dinamis siap di-generate jadi gambar QR.
 */
function generateDynamicQris(staticQris, nominal) {
  const clean = staticQris.trim();
  if (!clean.startsWith("00020101")) {
    throw new Error("Format QRIS statis tidak valid (harus diawali 00020101)");
  }

  const tags = parseTags(clean);
  const amountStr = String(Math.round(nominal));

  let output = "";
  let amountInserted = false;

  for (const t of tags) {
    if (t.tag === "63") continue; // skip CRC lama, akan dihitung ulang di akhir

    if (t.tag === "01") {
      // 11 = statis, 12 = dinamis (per transaksi)
      output += buildTLV("01", "12");
      continue;
    }

    // Tag 54 = Transaction Amount, harus diletakkan setelah tag 53 (currency)
    // dan sebelum tag 58 (country code), sesuai urutan EMVCo.
    if (t.tag === "58" && !amountInserted) {
      output += buildTLV("54", amountStr);
      amountInserted = true;
    }

    output += buildTLV(t.tag, t.value);
  }

  // fallback kalau tag 58 tidak ketemu (jarang terjadi), taruh amount sebelum akhir
  if (!amountInserted) {
    output += buildTLV("54", amountStr);
  }

  // Tambahkan tag 63 (CRC) dengan placeholder length "04", lalu hitung CRC dari
  // seluruh string TERMASUK "6304" di akhir.
  const payloadForCrc = output + "6304";
  const crc = crc16ccitt(payloadForCrc);
  output = payloadForCrc + crc;

  return output;
}

module.exports = { generateDynamicQris, crc16ccitt, parseTags };
