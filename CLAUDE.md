# FIP Sales Program — Onboarding Planner
## Project Documentation for Claude Code

---

## Project Overview

A web-based onboarding planning tool for the **FIP × Almarai Partnership Program**. Line managers assign each of 73 training sub-topics to one of three delivery points: **FIP premises**, **Almarai premises**, or **Field Training**. Each session creates an independent "submission" record. Admins view all submissions with analytics, charts, CSV export, per-submission PDF reporting, and a full login activity audit trail.

**Live URL:** `https://onboarding.fip.edu.sa`  
**Stack:** Node.js + Express · better-sqlite3 · express-session · bcryptjs · PM2 on AWS Ubuntu  
**Repo:** `https://github.com/fipitm/onboarding`

---

## Repository Structure

```
almarai_onboarding/
├── server.js                    # Express server, all API routes, SQLite schema
├── package.json
├── data/
│   └── onboarding.db            # SQLite database (auto-created)
├── public/                      # Static files served by Express
│   ├── login.html               # Login page (all users) — wallpaper + frosted card
│   ├── planner.html             # Main planning tool (normal users, ~3200 lines)
│   ├── admin-dashboard.html     # Admin — Frogetor design: Dashboard/Analytics/Submissions/Activity/Planner
│   ├── admin-users.html         # Admin user management — Frogetor design
│   ├── auth-db-bridge.js        # Session auth + server save bridge (loaded by planner.html)
│   ├── fip-logo.png             # FIP color logo (used in topbar, favicon)
│   ├── fip-logo-white.png       # White logo (planner header, PDF embedding)
│   ├── fip-logo-login.png       # Color logo for login page card
│   └── fip-wallpaper.jpg        # Login page background
└── scripts/
    └── create-admin.js          # CLI script to seed admin user
```

---

## Design System

The admin pages use the **Frogetor-inspired design** (Bootstrap 4 + MDI icons + Roboto):

- **FIP green top stripe**: 3px gradient bar at page top (`linear-gradient(90deg, #0d2145, #8DC63F, #0d2145)`)
- **Topbar**: 70px white bar, FIP color logo (hyperlinked to dashboard), user info + logout
- **Sidebar**: 270px white, MDI icons, green left-border active state
- **Page header**: Dark navy gradient (`#0d2145 → #1b3a6b`) with breadcrumb + title + inline stats
- **Cards**: `box-shadow: 0 0 24px rgba(0,0,0,.06)`, no borders, 6px radius
- **Font**: Roboto via Google Fonts
- **Charts**: ApexCharts 3.45.1

---

## User Roles & Flows

### Normal User (Line Manager)
1. Navigate to `onboarding.fip.edu.sa` → redirected to `/login.html`
2. Enter credentials → redirected to `/planner.html`
3. **Loading screen** (white, FIP logo + navy spinner) covers page while auth resolves
4. **Profile overlay** (white card on blurred backdrop) — blank fields on every new session: Name · Designation · Region
5. Click **"Start Planning"** → `POST /api/submissions` creates a new submission → overlay hides
6. On page **refresh**: `sessionStorage` (`fip_sub_id`) restores the existing submission, skips overlay
7. Work through 6 phases, assign each sub-topic to FIP / Almarai / Field Training
8. Each selection auto-saves via debounced `PUT /api/submissions/:id` (300ms)
9. **Sidebar phase navigation** locked — must complete all topics in current phase before advancing
10. View Summary → Export PDF or CSV from Summary page

### Admin User
1. Navigate to `onboarding.fip.edu.sa` → redirected to `/admin-dashboard.html`
2. **Dashboard**: 5 KPI cards (submissions, FIP/Almarai/Field CTH, avg per plan) with sparklines, distribution bar, recent submissions table
3. **Analytics**: Gradient donut chart, horizontal stacked bar (phases), submissions-over-time line chart
4. **Submissions**: Full searchable table with topic progress bars, proportion mini-bars, IP address, PDF download, CSV, delete per row, clear all with password protection
5. **Login Activity**: Full audit log (IP, browser, success/fail, timestamp)
6. **Planner View**: Iframe embed of planner.html (read-only, nothing saves)
7. **Manage Users**: Create, edit role, activate/deactivate, reset password, random-fill toggle

---

## Database Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  random_fill INTEGER NOT NULL DEFAULT 0,     -- DEV: auto-fill toggle per user
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE planner_profiles (
  user_id INTEGER PRIMARY KEY,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  responder_date TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE planner_selections (  -- legacy, still active for /api/planner
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP','Almarai','Field Training')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, row_idx),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ★ PRIMARY: one record per person per session
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',         -- captured at submission creation
  user_agent TEXT DEFAULT '',         -- captured at submission creation
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE submission_selections (
  submission_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP','Almarai','Field Training')),
  PRIMARY KEY (submission_id, row_idx),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

-- ★ Audit trail: every login attempt
CREATE TABLE login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,   -- 1=success, 0=failed/deactivated
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Reference (`server.js`)

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Validates credentials. Logs attempt to `login_logs` (success + failure). Returns `{ user }`. |
| POST | `/api/auth/logout` | Destroys session. |
| GET | `/api/auth/me` | Returns `{ user }` with `random_fill` field fetched fresh from DB. |

### Planner (legacy, still active)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/planner` | Returns `{ profile, selections }` from legacy tables. |
| PUT | `/api/planner` | Upserts profile + selections in legacy tables. |

### Submissions (primary data model)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/submissions/:id` | requireAuth | Returns own submission + selections. Server verifies `user_id` ownership. Used by bridge for page-refresh restore. |
| POST | `/api/submissions` | requireAuth | Creates new submission. Captures `ip_address` and `user_agent` from request. Returns `{ submissionId }`. |
| PUT | `/api/submissions/:id` | requireAuth | Replaces all selections for a submission. Verifies ownership. |

### Admin
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/admin/submissions` | requireAdmin | All submissions with `ip`, `ua`, selections array. |
| DELETE | `/api/admin/submissions` | requireAdmin | Clears ALL submissions + selections. Returns `{ cleared: N }`. |
| DELETE | `/api/admin/submissions/:id` | requireAdmin | Deletes one submission + its selections. |
| GET | `/api/admin/users` | requireAdmin | Lists all users with `random_fill` column. |
| POST | `/api/admin/users` | requireAdmin | Creates new user (bcrypt password). |
| PATCH | `/api/admin/users/:id` | requireAdmin | Updates `displayName`, `role`, `isActive`, `password`, or `randomFill`. |
| GET | `/api/admin/login-logs` | requireAdmin | Last 200 login attempts with IP, user agent, success flag, timestamp. |
| GET | `/api/report` | requireAdmin | Legacy report from old planner tables. |

### Helper
```javascript
function clientIP(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}
```

### Middleware
- **`requireAuth`** — Returns 401 if no session.
- **`requireAdmin`** — Returns 403 if role ≠ `admin`.

### Root redirect
```javascript
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login.html");
  return res.redirect(req.session.user.role === "admin" ? "/admin-dashboard.html" : "/planner.html");
});
```

---

## `planner.html` — Key Functions

### Static Data Constants
| Constant | Description |
|----------|-------------|
| `TOTAL` | 73 — total sub-topics |
| `HPD` | 6 — hours per day (for CTH → days conversion) |
| `SK` | `'fip_onboarding_v2'` — localStorage key (cleared on each new session) |
| `ROWS` | Array of 73 objects: `{ idx, phase_id, phase_name, topic, sub, cth }` |
| `PHASES_DATA` | Array of 6 phases: `{ id, name, rows: [[idx,cth],...], total }` |
| `PHASE_COLORS` | Map of phase ID → `{ color, accent, icon, name }` |

### Data Management
| Function | Description |
|----------|-------------|
| `getSelections()` | Reads all 73 radio inputs. Returns `{ 0: 'FIP', 1: null, ... }`. |
| `saveData()` | Overridden by `auth-db-bridge.js` → calls `debouncedSave()`. Original: saves to localStorage. |
| `loadData()` | Reads from localStorage, restores selections. Runs on page load (before bridge takes over). |
| `updateRow(idx, phaseId)` | Updates row highlight class, calls `saveData()`, `updateGlobal()`, `updatePhaseProgress()`. Overridden by bridge. |

### Navigation & Progress
| Function | Description |
|----------|-------------|
| `goToPhase(phaseId)` | Shows the target phase panel. Scrolls `content-area` to top. |
| `sidebarGoToPhase(targetId)` | Guards sidebar navigation: checks ALL phases before target are complete. Shows ⚠️ modal if incomplete. |
| `validatePhaseAndGo(fromId, toId)` | Guards Next button: checks current phase fully assigned. |
| `updateGlobal()` | Updates global progress bar fill % and "X / 73 assigned" counter. |
| `updatePhaseProgress(phaseId)` | Updates mini SVG ring, percentage text, and `done` class on phase nav button. |

### Summary & Export
| Function | Description |
|----------|-------------|
| `showSummaryPage()` | Hides planner view, shows summary page, calls `buildSummary()`. |
| `hideSummaryPage()` | Shows planner view, hides summary. |
| `buildSummary()` | Calculates all KPIs, distribution strip, phase breakdown cards, full detail table. |
| `printPlan()` | Calls `checkAllAssigned()` then `window.print()`. |
| `exportCSV()` | Calls `checkAllAssigned()`, generates CSV of all 73 rows. |
| `checkAllAssigned()` | Shows ⚠️ modal if any topics unassigned. Returns true/false. |

### Reset & Dev Tools
| Function | Description |
|----------|-------------|
| `resetAll()` | Shows confirmation modal, then calls `doReset()`. |
| `doReset()` | Clears all radio selections, removes highlights, saves, updates progress. Overridden by bridge. |
| `devRandomFill()` | Randomly assigns FIP/Almarai/Field Training to all 73 rows. Hidden by default; shown via bridge when `random_fill === 1`. |
| `startPlanner(e)` | Overridden by `auth-db-bridge.js`. Creates submission via API, hides overlay. |

---

## `auth-db-bridge.js` — Key Functions

Loaded by `planner.html` as the last `<script>`. Runs inside an IIFE. Captures original window functions then overrides them.

### Session & Auth
| Function | Description |
|----------|-------------|
| `requireSession()` | Fetches `/api/auth/me`. Redirects to `/login.html` if no session or network error. Sets `currentUser` and `window.currentUser`. |
| `roleGuardUi()` | Adds Logout + Dashboard buttons to progress bar (suppressed inside iframe). |

### Page Refresh Persistence
On every normal-user load:
1. Wipes all radio inputs + clears `localStorage` (`fip_onboarding_v2`)
2. Checks `sessionStorage('fip_sub_id')` for a saved submission ID
3. If found → `GET /api/submissions/:id` → restores `currentSubmissionId`, profile fields, all 73 selections
4. If not found (or 404) → shows blank profile overlay
5. On logout: clears `sessionStorage('fip_sub_id')`

### Data Persistence
| Function | Description |
|----------|-------------|
| `loadServerData()` | Fetches `/api/planner` (legacy), populates profile fields. |
| `persistPlanner()` | Saves current selections to `PUT /api/submissions/:currentSubmissionId`. No-op if `currentSubmissionId` is null. |
| `debouncedSave()` | 300ms debounce wrapper around `persistPlanner()`. Assigned to `window.saveData`. |
| `gatherSelections()` | Calls `window.getSelections()` if available, else returns `{}`. |

### Overrides
| Override | Description |
|----------|-------------|
| `window.saveData` | Replaced with `debouncedSave()`. |
| `window.updateRow` | Calls original `updateRow()` then `debouncedSave()`. |
| `window.doReset` | For admin: restored to original (no save). For users: calls original then `debouncedSave()`. |
| `window.startPlanner` | Async: calls `POST /api/submissions`, stores `currentSubmissionId`, saves to `sessionStorage('fip_sub_id')`, hides overlay. If `random_fill === 1`, fires `devRandomFill()` after 200ms. Shows error messages on failure, redirects to login on 401. |

### Admin Planner Setup (`setupAdminPlanner`)
- Hides `.planner-hdr` (no duplicate header)
- Hides `.planner-sidebar` (phase nav)
- Compacts instruction banner to single line
- Injects DEV buttons (Random Fill + Reset All) to progress bar
- If NOT in iframe: injects full admin sidebar nav, shifts body 210px right
- If IN iframe: skips sidebar injection (parent handles navigation)

### DEV Random Fill Button
- `#devRandomFillBtn` in planner sidebar — `display:none` by default
- Bridge sets `display:block` only when `currentUser.random_fill === 1`
- Hidden from all users when toggle is OFF in admin

### Window Load Sequence
```
window.load fires →
  requireSession()         [fetch /api/auth/me — includes random_fill]
  roleGuardUi()
  loadServerData()         [fetch /api/planner — legacy, profile only]

  if admin:
    window.saveData = no-op
    clear all radio inputs
    setupAdminPlanner()
  else:
    clear all radios + clear localStorage
    check sessionStorage('fip_sub_id'):
      if found → GET /api/submissions/:id → restore submission
      if not found → show blank profile overlay

  fade out loading screen
  applyRowHighlights()
  updateGlobal()
  updatePhaseProgress() for each phase
  show/hide #devRandomFillBtn based on random_fill flag
```

---

## `admin-dashboard.html` — Functions

### CDN Libraries
- Bootstrap 4.6 CSS (grid utilities)
- MDI icons 7.2 (mdi-* classes)
- Google Fonts: Roboto
- ApexCharts 3.45.1 (charts + sparklines)
- jsPDF 2.5.1 + jsPDF-autotable 3.5.31 (PDF generation)

### Static Data
```javascript
const cthByIdx = { 0:2, 1:2, ..., 72:2 };  // 73 row → CTH lookup
const PHASES = [{ n, s, e }, ...];           // 6 phases with row ranges
const ROWS = [{ idx, phase_name, topic, sub, cth }, ...];  // 73 full rows (for PDF)
```

### Init & Navigation
| Function | Description |
|----------|-------------|
| `init()` | Auth check → loads admin identity → fetches all submissions → builds dashboard + table → preloads planner iframe → hash routing. |
| `showSection(id, el)` | Hides all `.section` divs, shows `#sec-{id}`. Updates active nav, breadcrumb, page title. Triggers chart/activity build on first visit. Hides header stats for planner section. |
| `api(path)` | Fetch wrapper: throws on non-2xx, returns parsed JSON. |
| `logout()` | POST to /api/auth/logout then redirect to /login.html. |

### Dashboard Section
| Function | Description |
|----------|-------------|
| `buildDashboard()` | Calculates FIP/Almarai/Field totals across all submissions. Updates 5 KPI values + share badges + header stats. Sets distribution bar segments with % labels. Renders recent 5 submissions. Calls `buildSparklines()`. |
| `buildSparklines()` | Creates 5 ApexCharts sparkline area charts (one per KPI card). Data: per-submission CTH values. Colors match delivery point colors. |
| `propBar(fC, aC, flC)` | Returns HTML for a 6px 3-color proportion bar (FIP/Almarai/Field). Used in table rows. |
| `topicProg(assigned)` | Returns HTML for a mini green progress bar + "X/73" label. |

### Analytics Section (Charts)
| Function | Description |
|----------|-------------|
| `buildCharts()` | Builds 3 charts (called once on first Analytics tab click, `chartsBuilt` flag). |
| Gradient donut | `chartDist` — FIP/Almarai/Field CTH proportions, gradient fills, animated, data % labels. |
| Horizontal bar | `chartPhase` — per-phase CTH breakdown (FIP/Almarai/Field stacked horizontally). Phase names on Y-axis for readability. |
| Line chart | `chartLine` — submissions per month grouped from `submittedAt`. Shows "not enough data" message if < 2 months. |
| Phase summary table | `phaseSummaryBody` — each phase row: FIP/Almarai/Field/Total CTH + % of program. |

### Submissions Section
| Function | Description |
|----------|-------------|
| `renderTable()` | Filters `allSubs` by search query, renders full submissions table with IP address, topic progress bar, proportion bar, action buttons. Updates filter count label. |
| `deleteSubmission(id, name)` | Confirmation modal → `DELETE /api/admin/submissions/:id` → removes from `allSubs` array → rebuilds dashboard + table. |
| `confirmClearAll()` | Password-protected confirmation modal (password: `12345678`). On confirm: `DELETE /api/admin/submissions` → resets all data. |

### Login Activity Section
| Function | Description |
|----------|-------------|
| `loadActivity()` | Fetches `GET /api/admin/login-logs`. Renders table: #, Username, Status (success/failed badge), IP Address, Device/Browser, Timestamp. Browser auto-detected from user agent. Called each time tab is clicked. |

### Modal (View Submission)
| Function | Description |
|----------|-------------|
| `openModal(id)` | Finds submission, populates modal KPI tiles, phase breakdown table, meta line (includes IP). Opens modal. |
| `closeModal()` | Hides modal, clears `currentSub`. |
| `openAndPrint(id)` | Sets `currentSub` then calls `printSubmission()` directly. |

### PDF Export (`printSubmission`)
Uses jsPDF 2.5.1 + jsPDF-autotable. Generates a 2-page A4 PDF (portrait):

**Page 1 — Summary:**
- Navy header bar with FIP white logo (base64 embedded), program title, green accent stripe
- Respondent details right-aligned (name, designation, region, date)
- 4 KPI boxes: FIP CTH, Almarai CTH, Field Training CTH, Total CTH (with % share)
- Distribution bar: proportional colored segments (FIP=blue, Almarai=navy, Field=amber) with legend
- Phase breakdown table (6 rows): FIP/Almarai/Field/Total/Assigned

**Page 2 — Full Detail:**
- All 73 sub-topics grouped under navy phase header rows
- Columns: Main Topic | Sub Topic | Delivery Point | CTH
- Delivery point values color-coded (FIP=blue, Almarai=navy, Field=amber, Unassigned=red)
- Program total row (441 CTH)
- Footer on every page: "Confidential · Page X"
- Filename: `FIP_[Name]_[date].pdf`

```javascript
// Logo preloaded as base64 on page load:
var _pdfLogo = null;
// img.src = '/fip-logo-white.png' → canvas → _pdfLogo = { url, w, h }
```

### CSV Exports
| Function | Description |
|----------|-------------|
| `exportCurrentCSV()` | Calls `exportSubCSV(currentSub)`. |
| `exportSubCSV(s)` | 2-section CSV: profile header + phase breakdown per submission. Filename: `FIP_{name}_{date}.csv`. |
| `exportAllCSV()` | Flat CSV of all submissions (one row per submission). Filename: `FIP_Submissions_{date}.csv`. |
| `dl(rows, filename)` | Creates Blob URL, triggers download via temporary `<a>` element. |

---

## `admin-users.html` — Functions

Frogetor-designed page matching admin-dashboard.html layout (same topbar, sidebar, header).

| Function | Description |
|----------|-------------|
| `loadUsers()` | Fetches `/api/admin/users`, renders all users via `rowHtml()`, updates user count in page header. |
| `rowHtml(u, editing)` | Returns table row HTML. Normal view: avatar, role badge, status badge, random-fill toggle, action buttons. Edit view: inline inputs for display name + role select. |
| `editRow(id)` | Replaces the row's `outerHTML` with the editing version. |
| `saveUser(id)` | Reads inline input values, calls `PATCH /api/admin/users/:id`. Reloads table on success. |
| `toggleUser(id, isActive)` | Calls `PATCH` with `{ isActive }`. Reloads table. |
| `toggleRandomFill(id, enabled)` | Calls `PATCH` with `{ randomFill }`. Updates the `random_fill` column. Reloads table. |
| `createUser(e)` | Handles create form submit, calls `POST /api/admin/users`. Closes panel after 1.2s on success. |
| `openPwModal(id, username)` | Shows password reset modal. |
| `closePwModal()` | Hides modal. |
| `confirmReset()` | Validates password ≥ 6 chars, calls `PATCH` with `{ password }`. |
| `toggleCreatePanel()` | Toggles create panel visibility. |
| `showMsg(id, txt, type)` | Updates notify element with text and CSS class (ok/err). |

### Random Fill Toggle
- CSS toggle switch (green when ON, gray when OFF) per user row
- When ON: planner auto-fills all 73 rows after user clicks "Start Planning"
- The `#devRandomFillBtn` in planner sidebar is shown/hidden by bridge based on this flag
- Turn OFF before going live (no code changes needed)

---

## Planner UI — Delivery Point Selection

### Tick-Mark Circles
- Each option (FIP / Almarai / Field) rendered as a **34px circle** with ✓ checkmark
- Unselected: faint circle with dim ✓ (opacity 0.25)
- Selected: solid colour fill + white ✓ + glow shadow
- Column headers: **FIP** (blue `#4A90C4`) | **Almarai** (navy `#1B3A6B`) | **Field** (amber `#C27C0A`)

### Phase Navigation Lock
- **Next button**: `validatePhaseAndGo(fromId, toId)` — blocks if current phase incomplete
- **Sidebar clicks**: `sidebarGoToPhase(targetId)` — checks ALL phases before target; backward always allowed
- Shows modal with count of unassigned topics and phase name

### Instruction Banner
```html
<div class="instr-banner" id="instrBanner">
  📋  Select one delivery point per sub-topic:
  [FIP pill] [Almarai pill] [Field Training pill]
  — selections save automatically
</div>
```
Banner is compact (single line), styled with navy gradient + green left border.
The admin bridge replaces this innerHTML for admin sessions.

---

## Submission Flow (Multiple Users, Shared Account)

```
Scenario A — Group decision:
  Login → profile overlay → 1 submission created
  All selections = group consensus

Scenario B — Individual decisions:
  Each person logs in → each sees blank profile overlay
  Each clicks "Start Planning" → separate submission per person
  Admin sees N submissions from same account with different names
```

Each `startPlanner()` call creates a new `submissions` row. Selections link to `submission_id`, not `user_id`. Same account → unlimited independent submissions.

---

## CTH Reference

```
Phase 1 — Job Description        (rows 0-6,   7 topics,  24 CTH)  2,2,2,2,4,6,6
Phase 2 — Pre Execution          (rows 7-17,  11 topics, 84 CTH)  10,10,8,10,8,6,6,6,8,8,4
Phase 3 — Introduction           (rows 18-29, 12 topics, 58 CTH)  0,0,2,2,2,8,6,4,12,6,6,10
Phase 4 — Execution              (rows 30-58, 29 topics, 197 CTH) 12,12,8,4,6,8,8,6,8,8,4,6,10,10,8,8,10,6,6,5,6,5,5,5,5,5,6,3,4
Phase 5 — Exec–Specialization    (rows 59-69, 11 topics, 44 CTH)  2,8,4,4,2,6,2,2,6,4,4
Phase 6 — Closing                (rows 70-72,  3 topics, 34 CTH)  8,24,2
Total: 441 CTH across 73 sub-topics
```

`cthByIdx` lookup map is duplicated in: `planner.html`, `admin-dashboard.html`.
Any CTH correction must be updated in **both** files.

---

## Security & Audit Features

### Login Logging
Every login attempt (success, wrong password, deactivated account) is written to `login_logs`:
```javascript
{ user_id, username, success: 0|1, ip_address, user_agent, logged_at }
```
Visible to admins at: **Admin → Login Activity** tab.

### IP Address Capture
Each submission records the submitter's IP and browser at creation time.
Visible in: Submissions table (IP column), View modal (meta line).

### Clear All — Password Protection
The "Clear All Data" button in Submissions requires password `12345678` before executing.
Prevents accidental deletion. The DELETE endpoint is admin-only server-side.

### Per-Submission Delete
`DELETE /api/admin/submissions/:id` — admin only, verifies submission exists.

---

## AWS Deployment

**Server:** Ubuntu EC2, `/var/www/onboarding`  
**Process manager:** PM2 (`onboarding-tool`)  
**Node app:** `server.js` on port 3000  

### Standard Deploy Commands
```bash
cd /var/www/onboarding
git pull origin main
npm install --omit=dev
pm2 restart onboarding-tool
pm2 save
```

### After HTML/CSS-only changes
```bash
cd /var/www/onboarding
git pull origin main
pm2 restart onboarding-tool
pm2 save
```

---

## Known Constraints & Rules

1. `planner.html` is a large single-file page (~3200 lines). All 73 topic rows are static HTML.
2. `cthByIdx` is duplicated in `planner.html` and `admin-dashboard.html` (ROWS array also in admin). Any CTH correction must be updated in both.
3. The planner iframe inside admin dashboard uses `window.self !== window.top` detection to suppress navigation buttons and sidebar injection.
4. `localStorage` key `'fip_onboarding_v2'` is cleared by the bridge on every new user session to prevent stale selections bleeding in.
5. `sessionStorage` key `'fip_sub_id'` persists the active submission ID within the browser tab session. Cleared on logout or if server returns 404 for that ID.
6. The `random_fill` column is a dev/testing feature. Set all users to `0` before going live.
7. The admin default seeded account: username `admin`, password `Admin@123`.
8. The "Clear All Data" password is `12345678`.
9. Session store is in-memory (MemoryStore) — sessions are lost on PM2 restart. The bridge handles this gracefully: if `/api/submissions/:id` returns 404 after restart, shows overlay for new submission.
10. jsPDF white logo is preloaded as base64 canvas at page load in admin-dashboard for PDF embedding.
