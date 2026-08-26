async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan");
  return data;
}

async function getCurrentUser() {
  try {
    const { user } = await apiFetch("/api/auth/me");
    return user;
  } catch {
    return null;
  }
}

function formatRupiah(n) {
  return "Rp " + Number(n).toLocaleString("id-ID");
}

async function renderNavUser() {
  const slot = document.getElementById("nav-user-slot");
  if (!slot) return;
  const user = await getCurrentUser();
  if (user) {
    slot.innerHTML = `
      <a href="/dashboard.html">Halo, ${user.name.split(" ")[0]}</a>
      ${user.role === "admin" ? '<a href="/admin.html">Admin</a>' : ""}
      <button class="btn btn-outline" id="logout-btn">Logout</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    });
  } else {
    slot.innerHTML = `
      <a href="/login.html">Login</a>
      <a class="btn btn-primary" href="/register.html">Daftar</a>
    `;
  }
}

// Bubble WhatsApp melayang di pojok kanan bawah, tampil di semua halaman.
function renderWaBubble() {
  if (document.getElementById("wa-float-btn")) return;
  const CONTACT_WHATSAPP = "6282120885495";
  const a = document.createElement("a");
  a.id = "wa-float-btn";
  a.className = "wa-float";
  a.href = `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent("Halo MarketPanelServer, saya mau tanya-tanya")}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.setAttribute("aria-label", "Chat WhatsApp Admin");
  a.innerHTML = `
    <span class="wa-ring"></span>
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 3C9.4 3 4 8.4 4 15c0 2.3.6 4.4 1.8 6.3L4 29l7.9-1.7c1.8 1 3.9 1.5 6.1 1.5 6.6 0 12-5.4 12-12S22.6 3 16 3z" fill="#fff"/>
      <path d="M23.2 19.5c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.7.2-.2.3-.8 1.1-1 1.3-.2.2-.4.3-.7.1-.3-.2-1.4-.5-2.7-1.7-1-.9-1.7-2-1.9-2.3-.2-.3 0-.5.2-.7.2-.2.3-.4.5-.6.2-.2.2-.4.3-.6.1-.2 0-.5 0-.7-.1-.2-.7-1.8-1-2.4-.3-.6-.5-.6-.7-.6h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.3 5.2 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 2-.8 2.2-1.6.3-.8.3-1.5.2-1.6-.1-.1-.3-.2-.6-.4z" fill="#25D366"/>
    </svg>
  `;
  document.body.appendChild(a);
}

document.addEventListener("DOMContentLoaded", () => {
  renderNavUser();
  renderWaBubble();
});
