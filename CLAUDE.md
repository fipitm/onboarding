# FIP Sales Program — Onboarding Planner
## Project Documentation for Claude Code

---

## Project Overview

A web-based onboarding planning tool for the **FIP × Almarai Partnership Program**. Line managers use it to assign each of 73 training sub-topics to one of three delivery points: **FIP premises**, **Almarai premises**, or **Field Training**. Each session creates an independent "submission" record. Admins view all submissions with analytics, CSV export, and per-submission PDF reporting.

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
│   ├── login.html               # Login page (all users)
│   ├── planner.html             # Main planning tool (normal users)
│   ├── admin-dashboard.html     # Admin dashboard — Dashboard/Analytics/Submissions/Planner
│   ├── admin-users.html         # Admin user management
│   ├── auth-db-bridge.js        # Session auth + server save bridge (loaded by planner.html)
│   ├── fip-logo.png             # Logo (favicon)
│   ├── fip-logo-white.png       # White logo (header/sidebar)
│   ├── fip-wallpaper.jpg        # Login page background
│   ├── design-proposal-a.html   # Design preview A (Refined Classic) — standalone, no live impact
│   ├── design-proposal-b.html   # Design preview B (Corporate Light) — standalone
│   └── design-proposal-c.html   # Design preview C (Premium Dark) — standalone
└── scripts/
    └── create-admin.js          # CLI script to seed admin user
```

---

## User Roles & Flows

### Normal User (Line Manager)
1. Navigate to `onboarding.fip.edu.sa` → redirected to `/login.html`
2. Enter credentials → redirected to `/planner.html`
3. **Loading screen** (FIP logo + spinner) covers page while auth resolves
4. **Profile overlay** appears (blank fields every login): Name · Designation · Region
5. Click **"Start Planning"** → `POST /api/submissions` creates a new submission record → overlay hides
6. Work through 6 phases, assign each sub-topic to FIP / Almarai / Field Training
7. Each selection auto-saves to `submission_selections` table via debounced `PUT /api/submissions/:id`
8. **Sidebar phase navigation** is locked — must complete all topics in current phase before advancing
9. View Summary, Export PDF or CSV from the Summary page

### Admin User
1. Navigate to `onboarding.fip.edu.sa` → redirected to `/login.html`
2. Enter admin credentials → redirected to `/admin-dashboard.html`
3. **Admin Dashboard** — sidebar navigation: Dashboard · Analytics · Submissions · Planner View · Manage Users
4. No profile overlay, no selections saved — admin sessions are read-only in the planner
5. **Planner View** loads `planner.html` in an iframe (preloaded silently on dashboard init)

---

## Database Schema

```sql
-- Users table
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-user planner profile (legacy, still used for /api/planner endpoint)
CREATE TABLE planner_profiles (
  user_id INTEGER PRIMARY KEY,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  responder_date TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Legacy selections (one row per user per topic — overwrites each session)
CREATE TABLE planner_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP','Almarai','Field Training')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, row_idx),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ★ PRIMARY: Individual submissions (one per person per login session)
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Selections linked to a specific submission
CREATE TABLE submission_selections (
  submission_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP','Almarai','Field Training')),
  PRIMARY KEY (submission_id, row_idx),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
```

**Key design decision:** Multiple people sharing one login account each create their own `submissions` row by completing the profile overlay. Each submission is fully independent with its own `submission_selections`.

---

## API Reference (`server.js`)

### Authentication
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Validates credentials, creates session. Returns `{ user }`. |
| POST | `/api/auth/logout` | Destroys session. Requires `requireAuth`. |
| GET | `/api/auth/me` | Returns `{ user }` from session or `{ user: null }`. |

### Planner (legacy endpoint, still active)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/planner` | Returns `{ profile, selections }` for the logged-in user. |
| PUT | `/api/planner` | Upserts profile + selections for the logged-in user (overwrites). |

### Submissions (primary data model)
| Method | Route | Middleware | Description |
|--------|-------|-----------|-------------|
| POST | `/api/submissions` | requireAuth | Creates a new submission with name/desig/region. Returns `{ submissionId }`. |
| PUT | `/api/submissions/:id` | requireAuth | Replaces all selections for a submission. Verifies submission belongs to logged-in user. |
| GET | `/api/admin/submissions` | requireAuth + requireAdmin | Returns all submissions with per-row selections array for CTH calculation. |

### Admin
| Method | Route | Middleware | Description |
|--------|-------|-----------|-------------|
| GET | `/api/report` | requireAuth + requireAdmin | Legacy report: per-user profile + selections from old tables. |
| GET | `/api/admin/users` | requireAuth + requireAdmin | Lists all users with status and role. |
| POST | `/api/admin/users` | requireAuth + requireAdmin | Creates a new user (bcrypt hashed password). |
| PATCH | `/api/admin/users/:id` | requireAuth + requireAdmin | Updates displayName, role, isActive, or password. |

### Middleware
- **`requireAuth(req, res, next)`** — Returns 401 if no session. Used on all protected routes.
- **`requireAdmin(req, res, next)`** — Returns 403 if user role is not `admin`.

---

## `planner.html` — Key Functions

### Data Management
| Function | Description |
|----------|-------------|
| `getSelections()` | Reads all 73 radio inputs from DOM. Returns `{ 0: 'FIP', 1: null, ... }`. |
| `saveData()` | Overridden by `auth-db-bridge.js` → calls `debouncedSave()`. Original: saves to localStorage. |
| `loadData()` | Reads from localStorage, restores selections and profile fields to DOM. Runs on page load. |
| `updateRow(idx, phaseId)` | Updates row highlight class, calls `saveData()`, `updateGlobal()`, `updatePhaseProgress()`. |

### Navigation & Progress
| Function | Description |
|----------|-------------|
| `goToPhase(phaseId)` | Shows the target phase panel. Scrolls `content-area` to top (no page scroll). |
| `sidebarGoToPhase(targetId)` | Guards sidebar navigation: checks all phases before target are complete. Shows ⚠️ modal if incomplete. Calls `goToPhase()` only if all prior phases done. |
| `validatePhaseAndGo(fromId, toId)` | Guards Next button: checks `fromId` phase is fully assigned. Used by footer Next buttons. |
| `updateGlobal()` | Updates the global progress bar fill % and "X / 73 assigned" counter. |
| `updatePhaseProgress(phaseId)` | Updates the mini SVG ring, percentage text, and `done` class on the phase nav button. |

### Summary & Export
| Function | Description |
|----------|-------------|
| `showSummaryPage()` | Hides planner view, shows summary page, calls `buildSummary()`. |
| `hideSummaryPage()` | Shows planner view, hides summary. |
| `buildSummary()` | Calculates all KPIs (FIP/Almarai/Field CTH, assigned count), renders KPI cards, distribution strip, phase breakdown cards, and full detail table. |
| `printPlan()` | Calls `checkAllAssigned()` then `window.print()`. |
| `exportCSV()` | Calls `checkAllAssigned()`, generates CSV of all 73 rows with phase/topic/delivery/CTH. |
| `downloadPDF()` | Uses jsPDF + jsPDF-autotable to generate a 2-page PDF (summary + detail for admin). |
| `checkAllAssigned()` | Shows ⚠️ modal if any topics unassigned. Returns true/false. |

### Reset & Dev Tools
| Function | Description |
|----------|-------------|
| `resetAll()` | Shows confirmation modal, then calls `doReset()`. |
| `doReset()` | Clears all radio selections, removes highlight classes, saves, updates progress. |
| `devRandomFill()` | **DEV ONLY** — randomly assigns FIP/Almarai/Field Training to all 73 rows. Remove before go-live. |
| `startPlanner(e)` | Overridden by `auth-db-bridge.js`. Creates submission via API, hides profile overlay. |

### Static Data
| Constant | Description |
|----------|-------------|
| `TOTAL` | 73 — total number of sub-topics. |
| `PHASES_DATA` | Array of `{ id, name, rows: [[idx, cth], ...] }` — one entry per phase. |
| `ROWS` | Array of `{ idx, phase_id, phase_name, topic, sub, cth }` — one entry per sub-topic. |
| `PHASE_COLORS` | Map of phase ID → `{ color, accent, icon }`. |
| `SK` | localStorage key `'fip_onboarding_v2'`. |
| `HPD` | Hours per day (8) — used to convert CTH to days. |

---

## `auth-db-bridge.js` — Key Functions

This file is loaded by `planner.html` as an external script. It runs inside an IIFE and overrides several `window.*` functions to redirect data persistence from localStorage to the server API.

### Session & Role
| Function | Description |
|----------|-------------|
| `requireSession()` | Fetches `/api/auth/me`. Redirects to `/login.html` if no user. Sets `currentUser` and `window.currentUser`. |
| `roleGuardUi()` | Adds Logout button to progress bar. For admin, adds "← Dashboard" button. **Suppressed entirely when inside an iframe** (`window.self !== window.top`). |

### Data Persistence
| Function | Description |
|----------|-------------|
| `loadServerData()` | Fetches `/api/planner`, populates `responderName/Desig/Region/Date` inputs and radio selections from server data. Returns profile object. |
| `persistPlanner()` | Saves current selections to `PUT /api/submissions/:currentSubmissionId`. No-op if `currentSubmissionId` is null (admin or pre-submission). |
| `debouncedSave()` | 300ms debounce wrapper around `persistPlanner()`. Assigned to `window.saveData`. |
| `gatherSelections()` | Calls `window.getSelections()` if available, else returns `{}`. |

### Overrides
| Override | Description |
|----------|-------------|
| `window.saveData` | Replaced with `debouncedSave()`. |
| `window.updateRow` | Calls original `updateRow()` then `debouncedSave()`. |
| `window.doReset` | For admin: restored to original (no save). For users: calls original then `debouncedSave()`. |
| `window.startPlanner` | Async function: calls `POST /api/submissions`, stores `currentSubmissionId`, hides profile overlay. |

### Admin Planner Setup
| Function | Description |
|----------|-------------|
| `setupAdminPlanner()` | Called only when `currentUser.role === 'admin'`. Hides `.hdr` (no duplicate logo), hides phase sidebar, compacts instruction banner to single line, adds DEV buttons (Random Fill + Reset All) to progress bar. If NOT in iframe: injects full admin sidebar nav, shifts body 210px right. If IN iframe: skips sidebar injection (parent handles navigation). |

### Window Load Sequence
```
window.load fires →
  requireSession() [async fetch /api/auth/me]
  roleGuardUi()
  loadServerData() [async fetch /api/planner]
  
  if admin:
    window.saveData = no-op
    clear all radio selections
    setupAdminPlanner()
  else:
    clear profile overlay fields
    show profile overlay (display:flex)
  
  fade out loading screen (0.3s)
  applyRowHighlights()
  updateGlobal()
  updatePhaseProgress() for each phase
```

---

## `admin-dashboard.html` — Analytics Functions

### Data Loading
| Function | Description |
|----------|-------------|
| `init()` | Auth check → loads admin identity → fetches all submissions → calls `buildDashboard()` + `renderTable()` → preloads planner iframe → handles hash routing. |
| `api(path)` | Fetch wrapper: throws on non-2xx, returns parsed JSON. |

### Dashboard Section
| Function | Description |
|----------|-------------|
| `buildDashboard()` | Calculates total FIP/Almarai/Field CTH across all submissions. Updates 5 KPI cards, distribution bar segments with %, legend labels. Renders recent 5 submissions in mini-table with initials avatars. |
| `cth(sels, dp)` | Utility: sums CTH for all selections matching delivery point `dp`. Uses `cthByIdx` lookup map. |
| `initials(name)` | Returns 1-2 letter initials from a name string (e.g. "John Smith" → "JS"). |
| `avColor(name)` | Returns a consistent colour from `AV_COLORS` array based on first character code of name. |
| `fmt(dt)` | Formats ISO datetime string to `"YYYY-MM-DD HH:MM"`. |

### Analytics Section (Charts)
| Function | Description |
|----------|-------------|
| `buildCharts()` | Builds two Chart.js charts. Only called once on first Analytics tab click (`chartsBuilt` flag). |
| Doughnut chart | `chartDist` canvas — FIP/Almarai/Field CTH proportions across all submissions combined. Colors: #4a90c4 / #1b3a6b / #d97706. |
| Stacked bar chart | `chartPhase` canvas — per-phase CTH breakdown (FIP/Almarai/Field stacked) across all submissions combined. X-axis = 6 phases, Y-axis = CTH hours. |
| Phase summary table | Rendered inside `phaseSummaryBody` — each phase row shows FIP CTH, Almarai CTH, Field CTH, Total, % of program. |

### Submissions Section
| Function | Description |
|----------|-------------|
| `renderTable()` | Filters `allSubs` by live search query (name/desig/region/account), renders full submissions table with initials avatars, badges, action buttons. Updates filter count label. |

### CTH Lookup Map (`cthByIdx`)
Maps row index (0–72) to contact hours for that sub-topic. Used in both admin dashboard (analytics) and admin-users (not used there). Same values as in `planner.html`.

```
Phase 1 — Job Description (rows 0-6):     2,2,2,2,4,6,6 hrs
Phase 2 — Pre Execution (rows 7-17):      10,10,8,10,8,6,6,6,8,8,4 hrs
Phase 3 — Introduction (rows 18-29):      0,0,2,2,2,8,6,4,12,6,6,10 hrs
Phase 4 — Execution (rows 30-58):         12,12,8,4,6,8,8,6,8,8,4,6,10,10,8,8,10,6,6,5,6,5,5,5,5,5,6,3,4 hrs
Phase 5 — Exec-Specialization (rows 59-69): 2,8,4,4,2,6,2,2,6,4,4 hrs
Phase 6 — Closing (rows 70-72):           8,24,2 hrs
Total program: 441 CTH
```

### View Modal
| Function | Description |
|----------|-------------|
| `openModal(id)` | Finds submission by id in `allSubs`, populates modal KPI tiles and phase breakdown table. Opens modal. |
| `closeModal()` | Hides modal, clears `currentSub`. |
| `openAndPrint(id)` | Sets `currentSub` then calls `printSubmission()` directly (no modal). |

### Export Functions
| Function | Description |
|----------|-------------|
| `printSubmission()` | Builds inline HTML into `#printArea`, calls `window.print()`. CSS `@media print` hides everything except `#printArea`. Produces formatted A4 report with header, 4 KPI tiles, phase table. |
| `exportCurrentCSV()` | Calls `exportSubCSV(currentSub)`. |
| `exportSubCSV(s)` | Builds 2-section CSV (profile header + phase breakdown) for a single submission. Filename: `FIP_{name}_{date}.csv`. |
| `exportAllCSV()` | Builds flat CSV of all submissions (one row per submission with total CTH columns). Filename: `FIP_Submissions_{date}.csv`. |
| `dl(rows, filename)` | Creates Blob URL, triggers download via temporary `<a>` element. |

### Navigation
| Function | Description |
|----------|-------------|
| `showSection(id, el)` | Hides all `.section` divs, shows `#sec-{id}`. Updates active nav item and breadcrumb title. Lazy-loads analytics charts on first visit. Lazy-loads planner iframe on first visit (sets `src`, marks `data-loaded`). |
| Hash routing | After `init()` resolves, checks `location.hash` — e.g. `/admin-dashboard.html#planner` auto-calls `showSection('planner', ...)`. Used by links from `admin-users.html`. |
| Planner iframe preload | In `init()`, sets `plannerIframe.src = '/planner.html'` immediately so Planner View tab is instant. |

---

## `admin-users.html` — Functions

| Function | Description |
|----------|-------------|
| `loadUsers()` | Fetches `/api/admin/users`, renders all users via `rowHtml()`, updates user count subtitle. |
| `rowHtml(u, editing)` | Returns table row HTML. Normal view: initials avatar, role badge, status badge, Edit/Password/Deactivate buttons. Edit view: inline `tbl-input` for display name, `tbl-select` for role, Save/Cancel buttons. |
| `editRow(id)` | Replaces the row's `outerHTML` with the editing version of `rowHtml()`. |
| `saveUser(id)` | Reads inline input values, calls `PATCH /api/admin/users/:id`. Reloads table on success. |
| `toggleUser(id, isActive)` | Calls `PATCH /api/admin/users/:id` with `{ isActive }`. Reloads table. |
| `createUser(e)` | Handles create form submit, calls `POST /api/admin/users`. Closes panel after 1.2s on success. |
| `openPwModal(id, username)` | Shows password reset modal, sets target user. |
| `closePwModal()` | Hides password modal, clears `pwTargetId`. |
| `confirmReset()` | Validates password length ≥ 6, calls `PATCH /api/admin/users/:id` with `{ password }`. |
| `toggleCreatePanel()` | Toggles `create-panel.open` class. Focuses username input when opening. |
| `showMsg(id, txt, type)` | Updates a notify element with text and CSS class (`ok`/`err`). |

---

## Design System (Task Tracker Theme — Linear-inspired)

Applied to `admin-dashboard.html` and `admin-users.html`.

### CSS Custom Properties
```css
--bg: #f5f6fa          /* Page background */
--card: #ffffff         /* Card/surface background */
--sb: #ffffff           /* Sidebar background */
--border: #e4e8f0       /* All borders */
--primary: #5e6ad2      /* Indigo — active nav, buttons, focus rings */
--primary-light: #eef0fc /* Light indigo — pills, hover tints */
--text1: #0f172a        /* Primary text */
--text2: #64748b        /* Secondary text */
--text3: #94a3b8        /* Muted/placeholder text */
--navy: #0d2145         /* FIP brand navy — logo badge */
--grn: #8DC63F          /* FIP brand green — accent line */
--fip: #4a90c4          /* FIP delivery point colour */
--alm: #1b3a6b          /* Almarai delivery point colour */
--fld: #d97706          /* Field Training delivery point colour */
--r: 10px               /* Default border radius */
```

### Component Patterns
- **Sidebar:** 230px fixed, white bg, 1px right border, logo in 38px navy square badge
- **Nav items:** 7px 10px padding, 8px radius, indigo active state, `gap:8px` icon + text
- **KPI cards:** Top colour stripe per metric, hover `translateY(-1px)` lift
- **Badges:** 6px radius, outlined with colour-matched border
- **Avatars:** Rounded-square (6px radius), colour derived from `name.charCodeAt(0) % colors.length`
- **Table headers:** `position:sticky;top:0` — stays visible when scrolling
- **Modals:** Clean card (no dark gradient), border separator header/footer, `backdrop-filter:blur(2px)` overlay

---

## Planner UI — Delivery Point Selection

### Current Design (tick-mark style)
- Each of the 3 options (FIP / Almarai / Field) rendered as a **34px circle** with a ✓ checkmark
- Unselected: faint circle with dim ✓ (opacity 0.25)
- Selected: solid colour fill + white ✓ + glow shadow
- Column headers split into 3 sub-columns: **FIP** (blue) | **Almarai** (navy) | **Field** (amber)
- Vertical borders between all table columns via `border-right` on `th` and `td`

### Phase Navigation Lock
- **Next button:** `validatePhaseAndGo(fromId, toId)` — blocks if current phase incomplete
- **Sidebar clicks:** `sidebarGoToPhase(targetId)` — checks ALL phases before target are complete; going backward always allowed
- Incomplete phase shows modal with count of unassigned topics and phase name

---

## Submission Flow (Multiple Users, Shared Account)

```
Scenario A — Group decision (LMs sit together):
  Login → profile overlay (1 person enters details) → 1 submission created
  All selections represent the group consensus

Scenario B — Individual decisions (LMs in different locations):
  Each person logs in separately → each sees blank profile overlay
  Each clicks "Start Planning" → separate submission per person
  Admin sees N submissions from same account with different names
```

Each call to `startPlanner()` creates a new `submissions` row. Selections are linked to `submission_id`, not `user_id`, so the same account can have unlimited independent submissions.

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

### After CSS/HTML-only changes
```bash
cd /var/www/onboarding
git pull origin main
pm2 restart onboarding-tool
pm2 save
```

---

## Design Proposals (Separate Preview Files)

These files are standalone previews only. They do **not** affect any live page.

| File | URL | Status |
|------|-----|--------|
| `design-proposal-a.html` | `/design-proposal-a.html` | Refined Classic (navy header, coloured KPI borders) |
| `design-proposal-b.html` | `/design-proposal-b.html` | Corporate Light (white sidebar, rounded corners) |
| `design-proposal-c.html` | `/design-proposal-c.html` | Premium Dark (full dark theme, green accents) |

**Rule going forward:** All new design explorations must be created as separate `design-*.html` files. No changes to `planner.html`, `login.html`, or the auth bridge without explicit approval. Admin pages (`admin-dashboard.html`, `admin-users.html`) are the only pages approved for iterative UI changes.

---

## Dev-Only Features (Remove Before Go-Live)

### Random Fill Button
- **Location:** Sidebar bottom in `planner.html`, also injected into progress bar by `setupAdminPlanner()`
- **Function:** `devRandomFill()` in `planner.html`
- **Action:** Randomly assigns FIP / Almarai / Field Training to all 73 rows instantly
- **Removal:** Delete the `<!-- DEV ONLY -->` button HTML in `planner.html` sidebar and the `devRandomFill()` function

---

## Known Constraints

1. `planner.html` is a large single-file page (~3200 lines). All 73 topic rows are static HTML.
2. The `cthByIdx` map (row index → contact hours) is duplicated in three files: `planner.html`, `admin-dashboard.html`, and `auth-db-bridge.js` (indirectly via admin planner). Any CTH correction must be updated in all locations.
3. The planner iframe inside admin dashboard uses `window.self !== window.top` detection to suppress navigation buttons and sidebar injection.
4. `localStorage` key `'fip_onboarding_v2'` is still read by `loadData()` in `planner.html` but writes now go to the server via `auth-db-bridge.js`.
