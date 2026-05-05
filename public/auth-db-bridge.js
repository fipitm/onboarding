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
      reportBtn.textContent = "Admin Report";
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

      const dashboardBtn = document.createElement("button");
      dashboardBtn.className = "gp-summary-btn";
      dashboardBtn.style.marginLeft = "8px";
      dashboardBtn.textContent = "CEO Dashboard";
      dashboardBtn.onclick = () => {
        window.location.href = "/admin-dashboard.html";
      };
      byId("globalProg").appendChild(dashboardBtn);
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
