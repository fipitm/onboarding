/* ─── Shared utilities for v2 ────────────────────────────────────────────
   Loaded by all v2 pages. Exposes globals: api, logout, initials, avColor,
   fmt, cth, cthByIdx, PHASES, AV_COLORS
   ─────────────────────────────────────────────────────────────────────── */

/* CTH (contact hours) per row index 0–72 */
const cthByIdx = {
  0:2, 1:2, 2:2, 3:2, 4:4, 5:6, 6:6,
  7:10, 8:10, 9:8, 10:10, 11:8, 12:6, 13:6, 14:6, 15:8, 16:8, 17:4,
  18:0, 19:0, 20:2, 21:2, 22:2, 23:8, 24:6, 25:4, 26:12, 27:6, 28:6, 29:10,
  30:12, 31:12, 32:8, 33:4, 34:6, 35:8, 36:8, 37:6, 38:8, 39:8, 40:4,
  41:6, 42:10, 43:10, 44:8, 45:8, 46:10, 47:6, 48:6, 49:5, 50:6, 51:5,
  52:5, 53:5, 54:5, 55:5, 56:6, 57:3, 58:4,
  59:2, 60:8, 61:4, 62:4, 63:2, 64:6, 65:2, 66:2, 67:6, 68:4, 69:4,
  70:8, 71:24, 72:2
};

const PHASES = [
  { id: 1, name: 'Job Description',       s: 0,  e: 6  },
  { id: 2, name: 'Pre Execution',         s: 7,  e: 17 },
  { id: 3, name: 'Introduction',          s: 18, e: 29 },
  { id: 4, name: 'Execution',             s: 30, e: 58 },
  { id: 5, name: 'Exec – Specialization', s: 59, e: 69 },
  { id: 6, name: 'Closing',               s: 70, e: 72 }
];

const AV_COLORS = ['#5e6ad2','#4a90c4','#1b3a6b','#d97706','#059669','#dc2626','#7c3aed'];

/* ─── API wrapper ────────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ─── Auth helpers ───────────────────────────────────────────────────────── */
async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  window.location.href = '/v2/login.html';
}

async function requireAuth(expectedRole) {
  const data = await api('/api/auth/me').catch(() => ({ user: null }));
  if (!data.user) { window.location.href = '/v2/login.html'; return null; }
  if (expectedRole && data.user.role !== expectedRole) {
    window.location.href = data.user.role === 'admin'
      ? '/v2/admin/dashboard.html'
      : '/v2/planner.html';
    return null;
  }
  return data.user;
}

/* ─── UI utilities ───────────────────────────────────────────────────────── */
function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

function avColor(name) {
  return AV_COLORS[(name || '').charCodeAt(0) % AV_COLORS.length];
}

function fmt(dt) {
  return dt ? dt.slice(0, 16).replace('T', ' ') : '—';
}

/* ─── CTH calculator ─────────────────────────────────────────────────────── */
function cth(sels, dp) {
  return (sels || [])
    .filter(s => s.delivery_point === dp)
    .reduce((t, s) => t + (cthByIdx[s.row_idx] || 0), 0);
}

/* ─── Avatar HTML helper ─────────────────────────────────────────────────── */
function avHtml(name, size = 32) {
  const bg = avColor(name);
  return `<div class="av" style="width:${size}px;height:${size}px;background:${bg};">${initials(name)}</div>`;
}

/* ─── Sidebar active-nav helper ──────────────────────────────────────────── */
function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === id);
  });
}

/* ─── Wire up sidebar logout button if present ───────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
});
