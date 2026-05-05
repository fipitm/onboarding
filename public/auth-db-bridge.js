(function () {
  const ORIGINAL_SHOW_SUMMARY = window.showSummaryPage;
  const ORIGINAL_BUILD_SUMMARY = window.buildSummary;
  const ORIGINAL_RESET = window.doReset;
  const ORIGINAL_UPDATE_ROW = window.updateRow;

  let currentUser = null;
  let saveTimer = null;
  let currentSubmissionId = null;

  function byId(id) {
    return document.getElementById(id);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Request failed.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function requireSession() {
    const me = await api("/api/auth/me");
    if (!me.user) {
      window.location.href = "/login.html";
      return false;
    }
    currentUser = me.user;
    window.currentUser = me.user;
    return true;
  }

  function roleGuardUi() {
    if (!currentUser) return;

    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Logout";
    logoutBtn.className = "gp-summary-btn";
    logoutBtn.style.marginLeft = "8px";
    logoutBtn.onclick = async () => {
      try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/login.html";
    };
    byId("globalProg").appendChild(logoutBtn);

    if (currentUser.role !== "admin") {
      // non-admin: summary page is allowed, but hide admin-only controls
      document.querySelectorAll(".sh-export-btns .admin-only").forEach((el) => (el.style.display = "none"));
    } else {
      const reportBtn = document.createElement("button");
      reportBtn.className = "gp-summary-btn";
      reportBtn.style.marginLeft = "8px";
      reportBtn.textContent = "← Dashboard";
      reportBtn.onclick = showAdminReport;
      byId("globalProg").appendChild(reportBtn);

      const usersBtn = document.createElement("button");
      usersBtn.className = "gp-summary-btn";
      usersBtn.style.marginLeft = "8px";
      usersBtn.textContent = "Manage Users";
      usersBtn.onclick = () => {
        window.location.href = "/admin-users.html";
      };
      byId("globalProg").appendChild(usersBtn);

    }
  }

  async function showAdminReport() {
    window.location.href = "/admin-dashboard.html";
  }

  function gatherSelections() {
    if (typeof window.getSelections === "function") {
      return window.getSelections();
    }
    return {};
  }

  async function persistPlanner() {
    if (!currentSubmissionId) return;
    const selections = gatherSelections();
    await api(`/api/submissions/${currentSubmissionId}`, {
      method: "PUT",
      body: JSON.stringify({ selections })
    });
  }

  // Override startPlanner: create a new submission then open the planner
  window.startPlanner = async function (e) {
    e.preventDefault();
    const name   = (byId("responderName")  || {}).value.trim();
    const desig  = (byId("responderDesig") || {}).value.trim();
    const region = (byId("responderRegion")|| {}).value.trim();
    if (!name || !desig || !region) return;
    try {
      const result = await api("/api/submissions", {
        method: "POST",
        body: JSON.stringify({ name, desig, region })
      });
      currentSubmissionId = result.submissionId;
      const overlay = byId("profileOverlay");
      if (overlay) overlay.style.display = "none";
    } catch (err) {
      console.error("Failed to create submission:", err);
    }
  };

  function debouncedSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistPlanner().catch((e) => {
        const saveText = byId("saveText");
        if (saveText) saveText.textContent = `Save failed: ${e.message}`;
      });
    }, 300);
  }

  window.saveData = debouncedSave;
  window.updateRow = function (idx, phaseId) {
    ORIGINAL_UPDATE_ROW(idx, phaseId);
    debouncedSave();
  };
  window.doReset = function () {
    ORIGINAL_RESET();
    debouncedSave();
  };
  window.showSummaryPage = function () {
    ORIGINAL_SHOW_SUMMARY();
  };
  window.buildSummary = function () {
    ORIGINAL_BUILD_SUMMARY();
  };

  async function loadServerData() {
    const data = await api("/api/planner");
    const profile = data.profile || {};
    if (byId("responderName")) byId("responderName").value = profile.name || "";
    if (byId("responderDesig")) byId("responderDesig").value = profile.desig || "";
    if (byId("responderRegion")) byId("responderRegion").value = profile.region || "";
    if (byId("responderDate")) {
      byId("responderDate").value = profile.date || new Date().toISOString().split("T")[0];
    }

    const selections = data.selections || {};
    Object.keys(selections).forEach((k) => {
      const value = selections[k];
      if (!value) return;
      const input = document.querySelector(`input[name="row_${k}"][value="${value}"]`);
      if (input) input.checked = true;
    });

    return profile;
  }

  function setupAdminPlanner() {
    // Always hide the main planner header — logo/title live in the admin sidebar instead
    const hdr = document.querySelector('.hdr');
    if (hdr) hdr.style.display = 'none';

    // Hide planner's own phase sidebar
    const phaseSidebar = document.querySelector('.sidebar');
    if (phaseSidebar) phaseSidebar.style.display = 'none';

    // Compact instruction banner to a single line
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

    // Add DEV buttons to global progress bar
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

    // If loaded inside the admin dashboard iframe — no sidebar injection needed
    if (window.self !== window.top) return;

    // Standalone admin planner visit: inject persistent admin sidebar
    const lk = 'display:flex;align-items:center;gap:9px;padding:10px 16px;color:rgba(255,255,255,.6);text-decoration:none;font-size:12px;font-weight:500;border-left:3px solid transparent;';
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
        `<a href="/admin-dashboard.html" style="${lk}"><span>📊</span> Dashboard</a>` +
        `<a href="/admin-dashboard.html" style="${lk}"><span>📈</span> Analytics</a>` +
        `<a href="/admin-dashboard.html" style="${lk}"><span>📋</span> Submissions</a>` +
        `<div style="${lkA}"><span>🗂</span> Planner View</div>` +
        `<div style="${lbl}">Admin</div>` +
        `<a href="/admin-users.html" style="${lk}"><span>👥</span> Manage Users</a>` +
      '</div>' +
      '<div style="padding:10px;border-top:1px solid rgba(255,255,255,.08);">' +
        '<button id="adminSideLogout" style="display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:rgba(255,255,255,.65);font-size:12px;font-weight:600;cursor:pointer;">↩ Logout</button>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.getElementById('adminSideLogout').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch(e) {}
      window.location.href = '/login.html';
    });
    document.body.style.paddingLeft = '210px';
  }

  window.addEventListener("load", async () => {
    const ok = await requireSession();
    if (!ok) return;
    roleGuardUi();
    await loadServerData();

    if (currentUser.role === "admin") {
      // Admin: clear all selections — nothing saves for admin sessions
      window.saveData = function () {};
      window.doReset = ORIGINAL_RESET;
      document.querySelectorAll("input[type='radio']").forEach(r => r.checked = false);
      if (typeof window.applyRowHighlights === "function") window.applyRowHighlights();
      setupAdminPlanner();
    } else {
      // Normal user: show blank profile overlay on every login
      ["responderName", "responderDesig", "responderRegion"].forEach(id => {
        const el = byId(id);
        if (el) el.value = "";
      });
      const overlay = byId("profileOverlay");
      if (overlay) overlay.style.display = "flex";
    }

    // Fade out and remove loading screen — planner or overlay is now ready
    const ls = byId("loadingScreen");
    if (ls) {
      ls.style.opacity = "0";
      setTimeout(() => ls.remove(), 320);
    }

    if (typeof window.applyRowHighlights === "function") window.applyRowHighlights();
    if (typeof window.updateGlobal === "function") window.updateGlobal();
    const phaseButtons = document.querySelectorAll(".phase-nav-btn[data-phase]");
    phaseButtons.forEach((btn) => {
      const phaseId = btn.getAttribute("data-phase");
      if (phaseId && typeof window.updatePhaseProgress === "function") {
        window.updatePhaseProgress(phaseId);
      }
    });
  });
})();
