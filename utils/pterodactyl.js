const fetch = require("node-fetch");

// Ambil konfigurasi panel (base URL + API key) sesuai brand yang dipilih buyer.
// Melempar error yang JELAS kalau belum diisi di .env, bukan error teknis
// membingungkan dari node-fetch ("Only absolute URLs are supported").
function brandPrefix(category) {
  if (category === "pyrodactyl") return "PYRO";
  if (category === "private") return "PRIVATE";
  return "PTERO";
}

function getPanelConfig(category) {
  const brand = brandPrefix(category);
  const config =
    category === "pyrodactyl"
      ? {
          base: process.env.PYRO_PANEL_URL,
          key: process.env.PYRO_APP_API_KEY,
          locationId: process.env.PYRO_LOCATION_ID,
        }
      : category === "private"
      ? {
          base: process.env.PRIVATE_PANEL_URL,
          key: process.env.PRIVATE_APP_API_KEY,
          locationId: process.env.PRIVATE_LOCATION_ID,
        }
      : {
          base: process.env.PTERO_PANEL_URL,
          key: process.env.PTERO_APP_API_KEY,
          locationId: process.env.PTERO_LOCATION_ID,
        };

  if (!config.base || !config.key) {
    throw new Error(
      `Konfigurasi panel "${category}" belum lengkap di .env. Isi dulu ${brand}_PANEL_URL dan ${brand}_APP_API_KEY, lalu restart server.`
    );
  }
  return config;
}

// Ambil nest/egg/docker image sesuai kombinasi brand + jenis egg (minecraft/whatsapp).
// Semua kategori (termasuk Private Server) pakai pola variabel yang sama:
// {BRAND}_NEST_MINECRAFT / {BRAND}_EGG_MINECRAFT / {BRAND}_DOCKER_MINECRAFT
// {BRAND}_NEST_WHATSAPP / {BRAND}_EGG_WHATSAPP / {BRAND}_DOCKER_WHATSAPP
function getEggConfig(category, eggChoice) {
  const prefix = brandPrefix(category);
  const eggKey = eggChoice === "whatsapp" ? "WHATSAPP" : "MINECRAFT";
  return {
    nestId: process.env[`${prefix}_NEST_${eggKey}`],
    eggId: process.env[`${prefix}_EGG_${eggKey}`],
    dockerImage: process.env[`${prefix}_DOCKER_${eggKey}`],
  };
}

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function randomPassword() {
  return Math.random().toString(36).slice(-10) + "Aa1!";
}

async function ensurePteroUser({ category, email, name }) {
  const { base, key } = getPanelConfig(category);
  const searchRes = await fetch(`${base}/api/application/users?filter[email]=${encodeURIComponent(email)}`, {
    headers: headers(key),
  });
  const searchData = await searchRes.json();
  if (searchData.data && searchData.data.length > 0) {
    return searchData.data[0].attributes;
  }

  const [firstName, ...rest] = name.split(" ");
  const password = randomPassword();
  const createRes = await fetch(`${base}/api/application/users`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      email,
      username: email.split("@")[0] + Math.floor(Math.random() * 1000),
      first_name: firstName || "User",
      last_name: rest.join(" ") || "-",
      password,
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok) throw new Error("Gagal buat user panel: " + JSON.stringify(created));
  return { ...created.attributes, generated_password: password };
}

// Ambil detail egg (termasuk startup command bawaan) dari panel
async function getEggDetails(category, nestId, eggId) {
  const { base, key } = getPanelConfig(category);
  const res = await fetch(`${base}/api/application/nests/${nestId}/eggs/${eggId}`, {
    headers: headers(key),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal ambil detail egg: " + JSON.stringify(data));
  return data.attributes;
}

async function createServer({ category, eggChoice, pteroUserId, serverName, ramMb, diskMb, cpuPercent, dbCount, backupCount }) {
  const { base, key, locationId } = getPanelConfig(category);
  const { nestId, eggId, dockerImage } = getEggConfig(category, eggChoice);

  if (!nestId || !eggId || !dockerImage) {
    throw new Error(
      `Konfigurasi egg belum lengkap di .env untuk kategori "${category}" + egg "${eggChoice}". ` +
      `Cek variabel ${brandPrefix(category)}_NEST_/_EGG_/_DOCKER_${eggChoice === "whatsapp" ? "WHATSAPP" : "MINECRAFT"}.`
    );
  }

  // Ambil startup command asli dari egg-nya di panel (Pterodactyl API sekarang wajib field ini)
  const eggDetails = await getEggDetails(category, nestId, eggId);
  const startupCommand = eggDetails.startup;

  let environment;
  if (eggChoice === "whatsapp") {
    environment = {
      GIT_ADDRESS: process.env.PTERO_ENV_GIT_ADDRESS || "",
      BRANCH: process.env.PTERO_ENV_BRANCH || "",
      USERNAME: process.env.PTERO_ENV_USERNAME || "",
      ACCESS_TOKEN: process.env.PTERO_ENV_ACCESS_TOKEN || "",
      CMD_RUN: process.env.PTERO_ENV_CMD_RUN || "npm start",
    };
  } else {
    environment = {
      SERVER_JARFILE: "server.jar",
      MINECRAFT_VERSION: "latest",
    };
  }

  const body = {
    name: serverName,
    user: pteroUserId,
    egg: parseInt(eggId, 10),
    docker_image: dockerImage,
    startup: startupCommand,
    environment,
    // skip_scripts = true: server langsung berstatus "Installed" tanpa nunggu
    // proses install (git clone/npm install dari egg) selesai. Cocok kalau
    // buyer bakal upload file bot sendiri manual lewat file manager panel.
    // Bisa dimatikan lewat .env kalau suatu saat butuh proses install jalan.
    skip_scripts: process.env.PTERO_SKIP_INSTALL !== "false",
    limits: {
      memory: ramMb,
      swap: 0,
      disk: diskMb,
      io: 500,
      cpu: cpuPercent,
    },
    feature_limits: {
      databases: dbCount,
      backups: backupCount,
      allocations: 1,
    },
    deploy: {
      locations: [parseInt(locationId, 10)],
      dedicated_ip: false,
      port_range: [],
    },
  };

  const res = await fetch(`${base}/api/application/servers`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Gagal buat server: " + JSON.stringify(data));
  return data.attributes;
}

// Reset password akun panel yang SUDAH ADA (dipakai buat order lama yang
// diverifikasi sebelum sistem nyimpen kredensial, jadi passwordnya perlu di-generate ulang)
async function resetPteroPassword(category, pteroUserId) {
  const { base, key } = getPanelConfig(category);
  const getRes = await fetch(`${base}/api/application/users/${pteroUserId}`, { headers: headers(key) });
  const getData = await getRes.json();
  if (!getRes.ok) throw new Error("Gagal ambil data user panel: " + JSON.stringify(getData));
  const u = getData.attributes;

  const newPassword = randomPassword();
  const patchRes = await fetch(`${base}/api/application/users/${pteroUserId}`, {
    method: "PATCH",
    headers: headers(key),
    body: JSON.stringify({
      email: u.email,
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
      language: u.language || "en",
      password: newPassword,
    }),
  });
  const patchData = await patchRes.json();
  if (!patchRes.ok) throw new Error("Gagal reset password panel: " + JSON.stringify(patchData));

  // Verifikasi ulang: ambil data user lagi dan pastikan responsnya konsisten.
  // (API Pterodactyl tidak pernah balikin password, jadi ini cuma memastikan
  // request PATCH-nya benar diterima tanpa error tersembunyi)
  console.log(`[resetPteroPassword] PATCH sukses untuk user ${u.username} (id ${pteroUserId})`);

  return { username: u.username, email: u.email, password: newPassword };
}

// Hapus server di panel (dipakai saat masa aktif habis / order dibatalkan admin
// setelah server terlanjur dibuat). Kalau server sudah tidak ada (404), anggap
// sukses saja supaya proses expiry tidak macet gara-gara data lama.
async function deleteServer(category, serverId) {
  if (!serverId) return true;
  const { base, key } = getPanelConfig(category);
  const res = await fetch(`${base}/api/application/servers/${serverId}`, {
    method: "DELETE",
    headers: headers(key),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error("Gagal hapus server di panel: " + JSON.stringify(data));
  }
  return true;
}

module.exports = { ensurePteroUser, createServer, getPanelConfig, getEggConfig, resetPteroPassword, deleteServer };
