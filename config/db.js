const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");

// ==== KENAPA GANTI KE TURSO (libSQL) ====
// Project ini awalnya pakai better-sqlite3 (file .db lokal). Itu TIDAK cocok
// dijalankan di Vercel karena Vercel serverless functions itu stateless &
// filesystem-nya read-only/temporary (tiap request bisa jalan di instance
// baru, isi /tmp juga hilang tiap cold start) -> data user/order/pembayaran
// bisa hilang kapan saja. Turso = SQLite yang di-hosting, dialek SQL-nya
// identik, cuma query-nya lewat network jadi async. Free tier Turso cukup
// besar untuk skala toko panel seperti ini.
//
// Wajib isi di .env / Vercel Project Settings -> Environment Variables:
//   TURSO_DATABASE_URL=libsql://nama-db-kamu.turso.io
//   TURSO_AUTH_TOKEN=isi_token_dari_turso
//
// Cara dapetin (gratis):
//   1. npm install -g @turso/cli   (atau curl -sSfL https://get.tur.so/install.sh | bash)
//   2. turso auth signup   (login pakai GitHub)
//   3. turso db create tokopanel
//   4. turso db show tokopanel --url        -> jadi TURSO_DATABASE_URL
//   5. turso db tokens create tokopanel     -> jadi TURSO_AUTH_TOKEN

if (!process.env.TURSO_DATABASE_URL) {
  console.warn(
    "[db] PERINGATAN: TURSO_DATABASE_URL belum diisi. Set env ini (lihat komentar di config/db.js) sebelum deploy."
  );
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./data/tokopanel.local.db", // fallback lokal kalau belum setup Turso (dev only)
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = migrate().catch((e) => {
      readyPromise = null; // biar next request coba migrate lagi kalau gagal
      throw e;
    });
  }
  return readyPromise;
}

async function migrate() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      ptero_user_id INTEGER,
      pyro_user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      ram_mb INTEGER NOT NULL,
      disk_mb INTEGER NOT NULL,
      cpu_percent INTEGER NOT NULL,
      databases INTEGER DEFAULT 1,
      backups INTEGER DEFAULT 1,
      price_weekly INTEGER NOT NULL,
      price_monthly INTEGER NOT NULL,
      allowed_eggs TEXT,
      badge TEXT,
      benefits TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_code TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      duration TEXT NOT NULL,
      egg_choice TEXT,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      server_name TEXT,
      qris_payload TEXT,
      ptero_server_id INTEGER,
      active_until TEXT,
      admin_note TEXT,
      panel_username TEXT,
      panel_password TEXT,
      panel_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      expires_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(package_id) REFERENCES packages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);

  await ensureColumns("users", [
    ["role", "TEXT DEFAULT 'user'"],
    ["ptero_user_id", "INTEGER"],
    ["pyro_user_id", "INTEGER"],
    ["private_user_id", "INTEGER"],
  ]);

  await ensureColumns("packages", [
    ["category", "TEXT DEFAULT 'pterodactyl'"],
    ["price_weekly", "INTEGER DEFAULT 0"],
    ["price_monthly", "INTEGER DEFAULT 0"],
    ["allowed_eggs", "TEXT"],
    ["badge", "TEXT"],
    ["benefits", "TEXT"],
    ["sort_order", "INTEGER DEFAULT 0"],
  ]);

  await ensureColumns("orders", [
    ["category", "TEXT DEFAULT 'pterodactyl'"],
    ["duration", "TEXT DEFAULT 'weekly'"],
    ["egg_choice", "TEXT"],
    ["active_until", "TEXT"],
    ["admin_note", "TEXT"],
    ["panel_username", "TEXT"],
    ["panel_password", "TEXT"],
    ["panel_url", "TEXT"],
  ]);

  const countRes = await client.execute("SELECT COUNT(*) as c FROM packages");
  const count = Number(countRes.rows[0].c);
  if (count === 0) {
    await seedAllPackages();
  } else {
    await migrateExistingPackages();
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await client.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [adminEmail] });
    if (existing.rows.length === 0) {
      const hash = bcrypt.hashSync(adminPassword, 10);
      await client.execute({
        sql: `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')`,
        args: ["Admin", adminEmail, hash],
      });
      console.log(`[seed] Admin dibuat: ${adminEmail}`);
    }
  }
}

async function ensureColumns(table, columns) {
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const existing = info.rows.map((c) => c.name);
  for (const [name, def] of columns) {
    if (!existing.includes(name)) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
      console.log(`[migrate] Kolom "${name}" ditambahkan ke tabel "${table}"`);
    }
  }
}

function b(arr) {
  return JSON.stringify(arr);
}

async function seedAllPackages() {
  const insertSql = `
    INSERT INTO packages
      (category, name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs, badge, benefits, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const gameEggs = JSON.stringify(["minecraft", "whatsapp"]);

  const gameTiers = getGameTiers();
  for (const brand of ["pterodactyl", "pyrodactyl"]) {
    for (let idx = 0; idx < gameTiers.length; idx++) {
      const t = gameTiers[idx];
      await client.execute({
        sql: insertSql,
        args: [brand, t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, gameEggs, t.badge, b(t.benefits), idx + 1],
      });
    }
  }

  const resellerTiers = getResellerTiers();
  for (let idx = 0; idx < resellerTiers.length; idx++) {
    const t = resellerTiers[idx];
    await client.execute({
      sql: insertSql,
      args: ["admin_panel", t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, null, t.badge, b(t.benefits), idx + 1],
    });
  }

  const privateTiers = getPrivateTiers();
  for (let idx = 0; idx < privateTiers.length; idx++) {
    const t = privateTiers[idx];
    await client.execute({
      sql: insertSql,
      args: ["private", t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, gameEggs, t.badge, b(t.benefits), idx + 1],
    });
  }
}

async function migrateExistingPackages() {
  const gameEggs = JSON.stringify(["minecraft", "whatsapp"]);
  const updSql = `
    UPDATE packages SET name=?, ram_mb=?, disk_mb=?, cpu_percent=?, databases=?, backups=?,
      price_weekly=?, price_monthly=?, badge=?, benefits=?, sort_order=?, allowed_eggs=? WHERE id=?
  `;
  const insertSql = `
    INSERT INTO packages
      (category, name, ram_mb, disk_mb, cpu_percent, databases, backups, price_weekly, price_monthly, allowed_eggs, badge, benefits, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const oldResellerRows = (
    await client.execute("SELECT id, name FROM packages WHERE category = 'admin_panel' ORDER BY sort_order ASC")
  ).rows;
  const resellerTiers = getResellerTiers();
  for (let idx = 0; idx < resellerTiers.length; idx++) {
    const t = resellerTiers[idx];
    const existing = oldResellerRows[idx];
    if (existing) {
      await client.execute({
        sql: updSql,
        args: [t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, t.badge, b(t.benefits), idx + 1, null, existing.id],
      });
    } else {
      await client.execute({
        sql: insertSql,
        args: ["admin_panel", t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, null, t.badge, b(t.benefits), idx + 1],
      });
    }
  }
  if (oldResellerRows.length > resellerTiers.length) {
    for (const row of oldResellerRows.slice(resellerTiers.length)) {
      await client.execute({ sql: "UPDATE packages SET is_active = 0 WHERE id = ?", args: [row.id] });
    }
  }

  const oldPrivateRows = (
    await client.execute("SELECT id FROM packages WHERE category = 'private' ORDER BY sort_order ASC")
  ).rows;
  const privateTiers = getPrivateTiers();
  for (let idx = 0; idx < privateTiers.length; idx++) {
    const t = privateTiers[idx];
    const existing = oldPrivateRows[idx];
    if (existing) {
      await client.execute({
        sql: updSql,
        args: [t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, t.badge, b(t.benefits), idx + 1, gameEggs, existing.id],
      });
    } else {
      await client.execute({
        sql: insertSql,
        args: ["private", t.name, t.ram, t.disk, t.cpu, t.db, t.bk, t.wk, t.mo, gameEggs, t.badge, b(t.benefits), idx + 1],
      });
    }
  }
  if (oldPrivateRows.length > privateTiers.length) {
    for (const row of oldPrivateRows.slice(privateTiers.length)) {
      await client.execute({ sql: "UPDATE packages SET is_active = 0 WHERE id = ?", args: [row.id] });
    }
  }

  console.log("[migrate] Paket Reseller Panel Server & Private Server diperbarui ke skema terbaru.");
}

function getGameTiers() {
  return [
    {
      name: "Starter", ram: 1024, disk: 5120, cpu: 50, db: 1, bk: 1, wk: 2000, mo: 3500, badge: null,
      benefits: [
        "Cocok untuk uji coba bot atau server kecil-kecilan",
        "Server otomatis aktif dalam hitungan menit setelah bayar",
        "Akses penuh file manager, console & database panel",
        "Dukungan dasar via WhatsApp",
      ],
    },
    {
      name: "Standard", ram: 2048, disk: 10240, cpu: 400, db: 2, bk: 2, wk: 3000, mo: 5000, badge: "Populer",
      benefits: [
        "RAM & CPU lebih lega untuk trafik menengah",
        "Slot database & backup lebih banyak dari Starter",
        "Prioritas antrian pembuatan server saat ramai",
        "Cocok untuk komunitas kecil-menengah",
      ],
    },
    {
      name: "Pro", ram: 4096, disk: 20480, cpu: 600, db: 3, bk: 3, wk: 6000, mo: 10000, badge: null,
      benefits: [
        "Performa tinggi untuk bot produksi / server ramai",
        "Slot backup otomatis lebih banyak, data lebih aman",
        "Respon dukungan teknis lebih cepat",
        "Ideal untuk proyek serius / komersial skala kecil",
      ],
    },
    {
      name: "Unlimited", ram: 0, disk: 0, cpu: 800, db: 5, bk: 5, wk: 5000, mo: 10000, badge: "Terbaik",
      benefits: [
        "RAM & Disk unlimited* mengikuti kewajaran pemakaian",
        "Alokasi CPU tertinggi di kelasnya",
        "Prioritas dukungan teknis paling atas",
        "Cocok untuk server besar / komunitas ramai",
      ],
    },
  ];
}

function getResellerTiers() {
  return [
    {
      name: "Reseller Panel 4GB", ram: 4096, disk: 0, cpu: 200, db: 0, bk: 0, wk: 8000, mo: 15000, badge: null,
      benefits: [
        "VPS + panel Pterodactyl siap pakai atas nama kamu sendiri",
        "Bebas atur nest, egg, dan harga jual paket sendiri",
        "Setup awal (instalasi panel & Wings) dibantu penuh oleh admin",
        "Cocok untuk yang baru mulai bisnis reseller panel",
      ],
    },
    {
      name: "Reseller Panel 8GB", ram: 8192, disk: 0, cpu: 300, db: 0, bk: 0, wk: 15000, mo: 22000, badge: "Populer",
      benefits: [
        "Kapasitas lebih besar untuk menampung lebih banyak buyer",
        "Setup & optimasi awal dibantu langsung oleh admin",
        "Prioritas dukungan teknis khusus reseller",
        "Cocok untuk yang sudah mulai aktif jualan",
      ],
    },
    {
      name: "Reseller Panel 16GB", ram: 16384, disk: 0, cpu: 400, db: 0, bk: 0, wk: 20000, mo: 30000, badge: "Kapasitas Maksimal",
      benefits: [
        "Kapasitas terbesar untuk skala bisnis reseller yang sudah besar",
        "Setup, tuning, dan pendampingan awal oleh admin",
        "Prioritas dukungan tertinggi, respon tercepat",
        "Cocok menampung puluhan server buyer sekaligus",
      ],
    },
  ];
}

function getPrivateTiers() {
  return [
    {
      name: "Private Starter", ram: 5120, disk: 20480, cpu: 400, db: 2, bk: 2, wk: 5000, mo: 18000, badge: null,
      benefits: [
        "Berjalan di atas VPS khusus 16GB/4-core, bukan node berbagi biasa",
        "Root/akses admin penuh — bebas install & konfigurasi sendiri",
        "Nest & egg custom, fleksibel sesuai kebutuhan kamu",
        "Prioritas antrian setup dibanding paket reguler",
      ],
    },
    {
      name: "Private Pro", ram: 10240, disk: 40960, cpu: 400, db: 3, bk: 3, wk: 9000, mo: 30000, badge: "Populer",
      benefits: [
        "Semua benefit Private Starter, dengan RAM & Disk lebih besar",
        "Gratis 1x migrasi data dari server lama",
        "Monitoring resource real-time dari panel",
        "Respon dukungan prioritas, target di bawah 15 menit",
      ],
    },
    {
      name: "Private Unlimited", ram: 0, disk: 0, cpu: 400, db: 0, bk: 0, wk: 8000, mo: 20000, badge: "Promo Bulanan",
      benefits: [
        "RAM & Disk unlimited* mengikuti kapasitas VPS 16GB/4-core",
        "Harga bulanan spesial — paling hemat untuk pemakaian jangka panjang",
        "Snapshot backup berkala & bebas reinstall egg sendiri",
        "Sesi konsultasi setup gratis bersama admin",
      ],
    },
  ];
}

// ==== Shim biar interface mirip better-sqlite3 (db.prepare(sql).get/all/run) ====
// Bedanya: sekarang semuanya ASYNC (harus dipakai dengan `await`), karena
// query jalan lewat network ke Turso, bukan baca file lokal.
function prepare(sql) {
  return {
    async get(...params) {
      await ready();
      const res = await client.execute({ sql, args: params });
      return res.rows[0];
    },
    async all(...params) {
      await ready();
      const res = await client.execute({ sql, args: params });
      return res.rows;
    },
    async run(...params) {
      await ready();
      const res = await client.execute({ sql, args: params });
      return {
        lastInsertRowid:
          res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
            ? Number(res.lastInsertRowid)
            : undefined,
        changes: res.rowsAffected,
      };
    },
  };
}

module.exports = { prepare, ready };
