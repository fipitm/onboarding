(function () {
  const ORIGINAL_SHOW_SUMMARY = window.showSummaryPage;
  const ORIGINAL_BUILD_SUMMARY = window.buildSummary;
  const ORIGINAL_RESET = window.doReset;
  const ORIGINAL_UPDATE_ROW = window.updateRow;

  let currentUser = null;
  let saveTimer = null;

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
      await api("/api/auth/logout", { method: "POST" });
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
    const data = await api("/api/report");
    const totalUsers = data.report.length;
    const completed = data.report.filter((item) => item.selections.length > 0).length;
    alert(`Admin Report\n\nUsers: ${totalUsers}\nUsers with saved plans: ${completed}\n\nDetailed records are available from /api/report.`);
  }

  function gatherSelections() {
    if (typeof window.getSelections === "function") {
      return window.getSelections();
    }
    return {};
  }

  async function persistPlanner() {
    const dateInput = byId("responderDate");
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split("T")[0];
    }
    const profile = {
      name: byId("responderName")?.value || "",
      desig: byId("responderDesig")?.value || "",
      region: byId("responderRegion")?.value || "",
      date: byId("responderDate")?.value || new Date().toISOString().split("T")[0]
    };
    const selections = gatherSelections();
    await api("/api/planner", {
      method: "PUT",
      body: JSON.stringify({ profile, selections })
    });
    const saveText = byId("saveText");
    if (saveText) {
      saveText.textContent = "Saved to server";
      setTimeout(() => {
        saveText.textContent = "Auto-saving";
      }, 1200);
    }
  }

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
  }

  window.addEventListener("load", async () => {
    const ok = await requireSession();
    if (!ok) return;
    roleGuardUi();
    await loadServerData();
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
