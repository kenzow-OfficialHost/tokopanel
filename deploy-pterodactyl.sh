#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/kenzow-OfficialHost/tokopanel.git"
DOMAIN="pterodactyl.kenxzo.my.id"

echo "== 1. Re-init git & push perubahan domain =="
git init -q
git add .
git commit -q -m "Update domain -> ${DOMAIN} + tambah favicon 48x48"
git branch -M main
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
git push -u origin main --force

echo "== 2. Install Vercel CLI (kalau belum ada) =="
if ! command -v vercel &> /dev/null; then
  npm install -g vercel
fi

echo "== 3. Login & link project Vercel =="
vercel login
vercel link --yes

echo "== 4. Tambah domain custom ke project =="
vercel domains add "$DOMAIN" || echo "Domain mungkin sudah ditambahkan sebelumnya, lanjut..."

echo "== 5. Deploy ke production =="
vercel --prod

echo ""
echo "=========================================================="
echo "SELESAI. Langkah manual yang WAJIB kamu lakukan sendiri:"
echo ""
echo "A) DNS di provider domain kenxzo.my.id, tambahkan:"
echo "   Tipe   : CNAME"
echo "   Nama   : pterodactyl"
echo "   Target : cname.vercel-dns.com"
echo "   (kalau pakai Cloudflare, set Proxy status ke 'DNS only'/awan abu-abu,"
echo "    bukan proxied, biar SSL Vercel jalan normal)"
echo ""
echo "B) Environment Variables di Vercel Dashboard -> Project -> Settings"
echo "   -> Environment Variables, isi minimal:"
echo "   JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, TURSO_DATABASE_URL,"
echo "   TURSO_AUTH_TOKEN, CRON_SECRET, PTERO_PANEL_URL, PTERO_APP_API_KEY, dst"
echo "   (lihat .env.example), lalu DOMAIN=https://${DOMAIN}"
echo "   Setelah isi env vars -> klik Redeploy sekali lagi."
echo "=========================================================="
