# TokoPanel — Panduan Deploy ke VPS

Target: VPS `38.49.208.28` → domain `marketpanel.kenxzo.my.id`

## 1. Persiapan awal di VPS

```bash
ssh root@38.49.208.28

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
apt install -y nodejs nginx

# Install PM2 (process manager biar app auto-restart & jalan terus)
npm install -g pm2
```

## 2. Arahkan domain

Di DNS provider domain `kenxzo.my.id`, buat A record:
```
marketpanel.kenxzo.my.id  ->  A  ->  38.49.208.28
```
Tunggu propagasi DNS (biasanya beberapa menit - 1 jam).

## 3. Upload project

Upload folder `tokopanel/` ini ke VPS, misal ke `/var/www/tokopanel`, lalu:

```bash
cd /var/www/tokopanel
npm install --production
cp .env.example .env
nano .env   # isi semua nilai, lihat panduan di bawah
```

### Isi wajib di `.env`:

| Variabel | Cara isi |
|---|---|
| `JWT_SECRET` | String random panjang, contoh: `openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Akun admin kamu, dibuat otomatis saat pertama kali server jalan |
| `QRIS_STATIC_STRING` | **Lihat langkah 4 di bawah** |
| `PTERO_PANEL_URL` | URL panel Pterodactyl kamu |
| `PTERO_APP_API_KEY` | Buat di Panel Admin Pterodactyl → Application API → generate key baru dengan izin penuh (read+write) untuk Users & Servers |
| `PTERO_DEFAULT_NEST_ID` / `EGG_ID` / `LOCATION_ID` | Cek di Panel Admin → Nests/Eggs/Locations, sesuaikan sama server type yang mau dijual (Minecraft, dsb) |

## 4. Cara dapetin `QRIS_STATIC_STRING`

1. Kamu punya QRIS statis (dari bank/e-wallet, biasanya berupa gambar QR yang kalau di-scan nominalnya bisa diisi manual).
2. Scan gambar QR itu pakai aplikasi "QR Code Reader" biasa (bukan aplikasi bank) — hasilnya berupa **teks panjang** diawali `00020101...` dan diakhiri 4 karakter CRC.
3. Copy teks itu persis, paste ke `QRIS_STATIC_STRING` di `.env`.
4. Sistem TokoPanel akan otomatis mengubahnya jadi QRIS dinamis (nominal ter-isi otomatis) setiap ada checkout, tanpa mengubah QRIS asli kamu.

⚠️ Simpan `.env` dengan aman, jangan pernah commit ke git publik — isinya termasuk secret & QRIS kamu.

## 5. Jalankan dengan PM2

```bash
cd /var/www/tokopanel
pm2 start server.js --name tokopanel
pm2 save
pm2 startup   # ikuti instruksi yang muncul biar auto-start saat VPS reboot
```

## 6. Setup Nginx reverse proxy + HTTPS

```bash
nano /etc/nginx/sites-available/tokopanel
```

Isi:
```nginx
server {
    listen 80;
    server_name marketpanel.kenxzo.my.id;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/tokopanel /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Pasang HTTPS gratis (Let's Encrypt)
apt install -y certbot python3-certbot-nginx
certbot --nginx -d marketpanel.kenxzo.my.id
```

Setelah ini, situs kamu sudah live di `https://marketpanel.kenxzo.my.id`.

## 7. Cara pakai sehari-hari

- **Kelola paket**: langsung lewat SQLite di `data/tokopanel.db`, atau tambahkan endpoint admin UI kalau mau (route `PUT/POST /api/packages` sudah tersedia, tinggal dibuatkan form-nya kalau perlu).
- **Verifikasi pembayaran**: buka `https://marketpanel.kenxzo.my.id/admin.html`, login pakai akun admin, cek mutasi bank/e-wallet kamu, cocokkan nominal & waktu dengan invoice, klik **Verifikasi** → server Pterodactyl otomatis dibuat & di-assign ke user.
- **Kalau nanti mau auto-verifikasi tanpa cek manual**: langganan layanan cek mutasi QRIS (mis. OkeConnect, Tripay, dsb), lalu minta bantuan saya untuk menyambungkan providernya ke endpoint `POST /api/webhook/qris-paid` yang sudah disiapkan di `routes/webhook.js` (tinggal isi `WEBHOOK_SECRET` di `.env` dan sesuaikan nama field sesuai dokumentasi provider).

## 8. Struktur project

```
tokopanel/
├── server.js              # entry point
├── config/db.js           # setup SQLite + seed paket & admin
├── routes/                # auth, packages, orders, admin, webhook
├── middleware/auth.js     # JWT guard
├── utils/qris.js          # inject nominal ke QRIS statis + hitung CRC16
├── utils/pterodactyl.js   # panggil Pterodactyl API buat auto-provision
├── public/                # semua halaman (index, menu, checkout, dashboard, admin, dll)
└── data/                  # database SQLite (auto dibuat)
```

## 9. Catatan penting

- Sistem ini pakai **verifikasi manual admin** (bukan otomatis), karena QRIS yang dipakai statis pribadi tanpa payment gateway. Setiap ada order masuk, kamu tetap perlu cek mutasi sendiri sebelum klik Verifikasi.
- Pastikan `PTERO_APP_API_KEY` punya akses cukup untuk membuat user & server di panel.
- Backup rutin file `data/tokopanel.db` (berisi semua data user & order).
