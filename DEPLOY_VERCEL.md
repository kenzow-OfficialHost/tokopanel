# Deploy TokoPanel ke Vercel

Project ini sudah disesuaikan supaya bisa jalan di Vercel (serverless). Perubahan utama dari versi VPS:

- **Database**: `better-sqlite3` (file lokal) diganti **Turso** (`@libsql/client`) — SQL-nya sama persis, cuma jadi async. Ini WAJIB, karena Vercel tidak punya filesystem persisten (data bisa hilang kalau tetap pakai SQLite file).
- **Server**: `server.js` sekarang di-export sebagai serverless function (`module.exports = app`), bukan cuma `app.listen()`.
- **Auto-expire paket**: yang tadinya `setInterval` (tidak jalan di serverless) sekarang jadi endpoint `/api/cron/expiry-check` yang dipanggil otomatis oleh **Vercel Cron** (lihat `vercel.json`, jadwal default: tiap hari jam 3 pagi UTC — cukup untuk cek masa aktif mingguan/bulanan; bisa dites manual kapan saja lewat tombol di admin.html).

## 1. Bikin database Turso (gratis)

```bash
npm install -g @turso/cli
turso auth signup          # login pakai GitHub
turso db create tokopanel
turso db show tokopanel --url        # ini jadi TURSO_DATABASE_URL
turso db tokens create tokopanel     # ini jadi TURSO_AUTH_TOKEN
```

## 2. Push project ke GitHub

```bash
git init
git add .
git commit -m "TokoPanel ready for Vercel"
git branch -M main
git remote add origin <url-repo-kamu>
git push -u origin main
```

## 3. Import ke Vercel

1. Buka https://vercel.com/new, import repo GitHub kamu.
2. Framework Preset: pilih **Other** (bukan Next.js dkk).
3. Sebelum klik Deploy, isi **Environment Variables** (Project Settings → Environment Variables). Minimal wajib:

| Variable | Isi |
|---|---|
| `JWT_SECRET` | random panjang (`openssl rand -hex 32`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | akun admin kamu |
| `TURSO_DATABASE_URL` | dari langkah 1 |
| `TURSO_AUTH_TOKEN` | dari langkah 1 |
| `CRON_SECRET` | random string bebas (biar endpoint cron aman) |
| `QRIS_STATIC_STRING` | string QRIS statis kamu (lihat README.md bagian 4) |
| `PTERO_PANEL_URL`, `PTERO_APP_API_KEY`, dst | sesuai panel Pterodactyl kamu, lihat `.env.example` |
| `DOMAIN` | domain Vercel kamu, contoh `https://tokopanel-kamu.vercel.app` |

4. Klik **Deploy**.

## 4. Setelah live

- Cek `https://domain-kamu.vercel.app/api/packages` — harus balikin JSON daftar paket (artinya DB Turso & migrasi tabel sukses jalan).
- Login admin di `/admin.html` pakai `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Vercel Cron (`/api/cron/expiry-check`) otomatis jalan sesuai jadwal di `vercel.json`. Kalau butuh interval lebih rapat dari yang diizinkan paket Vercel kamu (Hobby plan cuma bisa 1x/hari), pakai layanan cron eksternal gratis (mis. cron-job.org) yang hit `POST https://domain-kamu/api/admin/orders/check-expired` pakai token login admin, atau upgrade ke Vercel Pro.

## 5. Custom domain (opsional)

Project Settings → Domains → tambahkan domain kamu (mis. `pterodactyl.kenxzo.my.id`), lalu ikuti instruksi DNS (biasanya tinggal tambah CNAME ke `cname.vercel-dns.com`).

## Catatan

- Kalau suatu saat mau balik ke VPS biasa, `server.js` tetap bisa dijalankan manual (`node server.js`) — scheduler `setInterval` untuk auto-expire otomatis aktif lagi di mode ini.
- Jangan commit file `.env` ke git publik.
