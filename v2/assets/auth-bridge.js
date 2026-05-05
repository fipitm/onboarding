/* ─── v2 Auth + Persistence bridge for planner.html ─────────────────────
   Loaded by v2/planner.html. Runs inside an IIFE.
   Captures original window functions then overrides them to wire up:
     • Session auth (requireSession)
     • Server persistence (debouncedSave → PUT /api/submissions/:id)
     • Submission creation (startPlanner → POST /api/submissions)
     • Admin planner setup (read-only, no profile overlay)
   ─────────────────────────────────────────────────────────────────────── */
(function () {
  const ORIG_UPDATE_ROW    = window.updateRow;
  const ORIG_RESET         = window.doReset;
  const ORIG_SHOW_SUMMARY  = window.showSummaryPage;
  const ORIG_BUILD_SUMMARY = window.buildSummary;

  let currentUser        = null;
  let currentSubmissionId = null;
  let saveTimer          = null;

  function byId(id) { return document.getElementById(id); }

  async function apiBridge(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ── Auth ─────────────────────────────────────────────────────────── */
  async function requireSession() {
    const me = await apiBridge('/api/auth/me');
    if (!me.user) { window.location.href = '/v2/login.html'; return false; }
    currentUser = me.user;
    window.currentUser = me.user;
    return true;
  }

  /* ── UI: logout / dashboard buttons (not inside iframe) ───────────── */
  function roleGuardUi() {
    if (!currentUser) return;
    if (window.self !== window.top) return;   // inside admin iframe — skip

    const gp = byId('globalProg');
    if (!gp) return;

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.className = 'gp-summary-btn';
    logoutBtn.style.marginLeft = '8px';
    logoutBtn.onclick = async () => {
      try { await apiBridge('/api/auth/logout', { method: 'POST' }); } catch (_) {}
      window.location.href = '/v2/login.html';
    };
    gp.appendChild(logoutBtn);

    if (currentUser.role === 'admin') {
      const dashBtn = document.createElement('button');
      dashBtn.className = 'gp-summary-btn';
      dashBtn.style.marginLeft = '8px';
      dashBtn.textContent = '← Dashboard';
      dashBtn.onclick = () => { window.location.href = '/v2/admin/dashboard.html'; };
      gp.appendChild(dashBtn);
    }
  }

  /* ── Server data load ─────────────────────────────────────────────── */
  async function loadServerData() {
    const data = await apiBridge('/api/planner');
    const profile = data.profile || {};
    if (byId('responderName'))   byId('responderName').value   = profile.name   || '';
    if (byId('responderDesig'))  byId('responderDesig').value  = profile.desig  || '';
    if (byId('responderRegion')) byId('responderRegion').value = profile.region || '';
    if (byId('responderDate')) {
      byId('responderDate').value = profile.date || new Date().toISOString().split('T')[0];
    }
    const selections = data.selections || {};
    Object.keys(selections).forEach(k => {
      const v = selections[k];
      if (!v) return;
      const inp = document.querySelector(`input[name="row_${k}"][value="${v}"]`);
      if (inp) inp.checked = true;
    });
    return profile;
  }

  /* ── Persistence ──────────────────────────────────────────────────── */
  function gatherSelections() {
    return typeof window.getSelections === 'function' ? window.getSelections() : {};
  }

  async function persistPlanner() {
    if (!currentSubmissionId) return;
    await apiBridge(`/api/submissions/${currentSubmissionId}`, {
      method: 'PUT',
      body: JSON.stringify({ selections: gatherSelections() })
    });
  }

  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistPlanner().catch(() => {}), 300);
  }

  /* ── Overrides ────────────────────────────────────────────────────── */
  window.saveData = debouncedSave;

  window.updateRow = function (idx, phaseId) {
    ORIG_UPDATE_ROW(idx, phaseId);
    debouncedSave();
  };

  window.doReset = function () {
    ORIG_RESET();
    debouncedSave();
  };

  window.showSummaryPage  = function () { ORIG_SHOW_SUMMARY(); };
  window.buildSummary     = function () { ORIG_BUILD_SUMMARY(); };

  /* ── startPlanner: create submission then open planner ────────────── */
  window.startPlanner = async function (e) {
    e.preventDefault();
    const name   = (byId('responderName')   || {}).value.trim();
    const desig  = (byId('responderDesig')  || {}).value.trim();
    const region = (byId('responderRegion') || {}).value.trim();
    if (!name || !desig || !region) return;
    try {
      const result = await apiBridge('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({ name, desig, region })
      });
      currentSubmissionId = result.submissionId;
      const overlay = byId('profileOverlay');
      if (overlay) overlay.style.display = 'none';
    } catch (err) {
      console.error('Failed to create submission:', err);
    }
  };

  /* ── Admin planner setup ──────────────────────────────────────────── */
  function setupAdminPlanner() {
    const hdr = document.querySelector('.planner-hdr');
    if (hdr) hdr.style.display = 'none';
    const sidebar = document.querySelector('.planner-sidebar');
    if (sidebar) sidebar.style.display = 'none';

    const instr = byId('instrBanner');
    if (instr) {
      instr.style.cssText = 'display:flex;align-items:center;gap:12px;padding:9px 28px;margin:0;background:linear-gradient(135deg,#0d2145,#1a2f5a);border-left:4px solid #8DC63F;border-radius:0;';
      instr.innerHTML =
        '<span style="font-size:15px;flex-shrink:0;">📋</span>' +
        '<p style="font-size:12px;color:rgba(255,255,255,.75);margin:0;">' +
          '<strong style="color:#8DC63F;">Admin View</strong> — Assign each sub-topic to a delivery point:' +
          '&nbsp;<span style="background:rgba(74,144,196,.2);color:#90cdf4;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🏛 FIP</span>' +
          '&nbsp;<span style="background:rgba(99,179,237,.15);color:#bee3f8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🏢 Almarai</span>' +
          '&nbsp;<span style="background:rgba(194,124,10,.2);color:#f6ad55;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">🚗 Field</span>' +
        '</p>';
    }

    const gp = byId('globalProg');
    if (gp) {
      const rnd = document.createElement('button');
      rnd.textContent = '🎲 Random Fill';
      rnd.className = 'gp-summary-btn';
      rnd.style.cssText = 'margin-left:8px;background:linear-gradient(135deg,#5B21B6,#7C3AED);';
      rnd.onclick = () => typeof window.devRandomFill === 'function' && window.devRandomFill();
      gp.appendChild(rnd);

      const rst = document.createElement('button');
      rst.textContent = '↺ Reset All';
      rst.className = 'gp-summary-btn';
      rst.style.cssText = 'margin-left:6px;background:linear-gradient(135deg,#742A2A,#C53030);';
      rst.onclick = () => typeof window.resetAll === 'function' && window.resetAll();
      gp.appendChild(rst);
    }

    if (window.self !== window.top) return;

    /* Standalone admin planner: inject nav sidebar */
    const lk  = 'display:flex;align-items:center;gap:9px;padding:10px 16px;color:rgba(255,255,255,.6);text-decoration:none;font-size:12px;font-weight:500;border-left:3px solid transparent;';
    const lkA = lk + 'border-left-color:#8DC63F;background:rgba(255,255,255,.08);color:#fff;';
    const lbl = 'font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);padding:12px 16px 4px;';
    const nav = document.createElement('div');
    nav.id = 'adminSideNav';
    nav.style.cssText = 'position:fixed;left:0;top:0;bottom:0;width:210px;background:#0d2145;z-index:400;display:flex;flex-direction:column;box-shadow:2px 0 10px rgba(0,0,0,.2);';
    nav.innerHTML =
      '<div style="padding:18px 16px 0;text-align:center;border-bottom:1px solid rgba(255,255,255,.08);">' +
        '<img src="/fip-logo-white.png" style="height:48px;display:block;margin:0 auto 10px;">' +
        '<div style="font-size:12px;font-weight:700;color:#fff;">FIP Sales Program</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,.45);margin-top:3px;padding-bottom:12px;letter-spacing:.3px;">Onboarding Planner</div>' +
        '<div style="height:2px;background:linear-gradient(90deg,transparent,#8DC63F,transparent);margin:0 -16px;"></div>' +
      '</div>' +
      '<div style="flex:1;padding:8px 0;overflow-y:auto;">' +
        `<div style="${lbl}">Menu</div>` +
        `<a href="/v2/admin/dashboard.html" style="${lk}"><span>📊</span> Dashboard</a>` +
        `<a href="/v2/admin/dashboard.html#analytics" style="${lk}"><span>📈</span> Analytics</a>` +
        `<a href="/v2/admin/dashboard.html#submissions" style="${lk}"><span>📋</span> Submissions</a>` +
        `<div style="${lkA}"><span>🗂</span> Planner View</div>` +
        `<div style="${lbl}">Admin</div>` +
        `<a href="/v2/admin/users.html" style="${lk}"><span>👥</span> Manage Users</a>` +
      '</div>' +
      '<div style="padding:10px;border-top:1px solid rgba(255,255,255,.08);">' +
        '<button id="adminSideLogout" style="display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);font-size:12px;font-weight:600;cursor:pointer;">↩ Logout</button>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    byId('adminSideLogout').addEventListener('click', async () => {
      try { await apiBridge('/api/auth/logout', { method: 'POST' }); } catch (_) {}
      window.location.href = '/v2/login.html';
    });
    document.body.style.paddingLeft = '210px';
  }

  /* ── Window load sequence ─────────────────────────────────────────── */
  window.addEventListener('load', async () => {
    const ok = await requireSession();
    if (!ok) return;

    roleGuardUi();
    await loadServerData();

    if (currentUser.role === 'admin') {
      window.saveData = function () {};
      window.doReset = ORIG_RESET;
      document.querySelectorAll("input[type='radio']").forEach(r => r.checked = false);
      if (typeof window.applyRowHighlights === 'function') window.applyRowHighlights();
      setupAdminPlanner();
    } else {
      ['responderName','responderDesig','responderRegion'].forEach(id => {
        const el = byId(id);
        if (el) el.value = '';
      });
      const overlay = byId('profileOverlay');
      if (overlay) overlay.style.display = 'flex';
    }

    const ls = byId('loadingScreen');
    if (ls) { ls.style.opacity = '0'; setTimeout(() => ls.remove(), 320); }

    if (typeof window.applyRowHighlights   === 'function') window.applyRowHighlights();
    if (typeof window.updateGlobal         === 'function') window.updateGlobal();
    document.querySelectorAll('.phase-nav-btn[data-phase]').forEach(btn => {
      const phaseId = btn.getAttribute('data-phase');
      if (phaseId && typeof window.updatePhaseProgress === 'function') {
        window.updatePhaseProgress(phaseId);
      }
    });
  });
})();
