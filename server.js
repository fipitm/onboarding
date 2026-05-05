const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const DB_PATH = path.join(__dirname, "data", "onboarding.db");
const TOTAL_ROWS = 73;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planner_profiles (
  user_id INTEGER PRIMARY KEY,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  responder_date TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planner_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP', 'Almarai', 'Field Training')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, row_idx),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_region TEXT DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS submission_selections (
  submission_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP', 'Almarai', 'Field Training')),
  PRIMARY KEY (submission_id, row_idx),
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
`);

const profileColumns = db.prepare("PRAGMA table_info(planner_profiles)").all();
const hasRegionColumn = profileColumns.some((c) => c.name === "responder_region");
if (!hasRegionColumn) {
  db.exec("ALTER TABLE planner_profiles ADD COLUMN responder_region TEXT DEFAULT ''");
}
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const hasIsActiveColumn = userColumns.some((c) => c.name === "is_active");
if (!hasIsActiveColumn) {
  db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}

function ensureUser(username, password, role, displayName) {
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, role, display_name, is_active) VALUES (?, ?, ?, ?, 1)"
  ).run(username, hash, role, displayName);
}

ensureUser("admin", "Admin@123", "admin", "System Administrator");

// Remove seed accounts that are no longer needed
db.prepare(
  "DELETE FROM users WHERE username IN ('admin_ops','admin_hr','manager_north','manager_central','manager_south')"
).run();

app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  return res.redirect("/planner.html");
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = db
    .prepare("SELECT id, username, password_hash, role, display_name, is_active FROM users WHERE username = ?")
    .get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: "This account is deactivated. Contact admin." });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name || user.username
  };

  return res.json({ user: req.session.user });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  return res.json({ user: req.session.user || null });
});

app.get("/api/planner", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const profile = db
    .prepare("SELECT responder_name, responder_desig, responder_region, responder_date FROM planner_profiles WHERE user_id = ?")
    .get(userId) || { responder_name: "", responder_desig: "", responder_region: "", responder_date: "" };

  const rows = db
    .prepare("SELECT row_idx, delivery_point FROM planner_selections WHERE user_id = ?")
    .all(userId);

  const selections = {};
  for (let i = 0; i < TOTAL_ROWS; i += 1) {
    selections[i] = null;
  }
  rows.forEach((r) => {
    selections[r.row_idx] = r.delivery_point;
  });

  return res.json({
    profile: {
      name: profile.responder_name || "",
      desig: profile.responder_desig || "",
      region: profile.responder_region || "",
      date: profile.responder_date || ""
    },
    selections
  });
});

app.put("/api/planner", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const profile = req.body?.profile || {};
  const selections = req.body?.selections || {};

  const upsertProfile = db.prepare(`
    INSERT INTO planner_profiles (user_id, responder_name, responder_desig, responder_region, responder_date, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      responder_name=excluded.responder_name,
      responder_desig=excluded.responder_desig,
      responder_region=excluded.responder_region,
      responder_date=excluded.responder_date,
      updated_at=CURRENT_TIMESTAMP
  `);
  const deleteSelections = db.prepare("DELETE FROM planner_selections WHERE user_id = ?");
  const insertSelection = db.prepare(`
    INSERT INTO planner_selections (user_id, row_idx, delivery_point, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const tx = db.transaction(() => {
    upsertProfile.run(
      userId,
      String(profile.name || ""),
      String(profile.desig || ""),
      String(profile.region || ""),
      String(profile.date || "")
    );
    deleteSelections.run(userId);
    Object.entries(selections).forEach(([idx, val]) => {
      if (val === "FIP" || val === "Almarai" || val === "Field Training") {
        insertSelection.run(userId, Number(idx), val);
      }
    });
  });
  tx();

  return res.json({ ok: true });
});

// ── Submissions: one record per person per session ──

app.post("/api/submissions", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const { name, desig, region } = req.body || {};
  const info = db.prepare(
    `INSERT INTO submissions (user_id, responder_name, responder_desig, responder_region, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(userId, String(name || ""), String(desig || ""), String(region || ""));
  return res.status(201).json({ submissionId: info.lastInsertRowid });
});

app.put("/api/submissions/:id", requireAuth, (req, res) => {
  const submissionId = Number(req.params.id);
  const userId = req.session.user.id;
  const { selections } = req.body || {};
  const sub = db.prepare("SELECT id FROM submissions WHERE id = ? AND user_id = ?").get(submissionId, userId);
  if (!sub) return res.status(403).json({ error: "Not found." });
  const del = db.prepare("DELETE FROM submission_selections WHERE submission_id = ?");
  const ins = db.prepare("INSERT INTO submission_selections (submission_id, row_idx, delivery_point) VALUES (?, ?, ?)");
  const upd = db.prepare("UPDATE submissions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  db.transaction(() => {
    del.run(submissionId);
    Object.entries(selections || {}).forEach(([idx, val]) => {
      if (val === "FIP" || val === "Almarai" || val === "Field Training") {
        ins.run(submissionId, Number(idx), val);
      }
    });
    upd.run(submissionId);
  })();
  return res.json({ ok: true });
});

app.get("/api/admin/submissions", requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.responder_name, s.responder_desig, s.responder_region,
           s.submitted_at, s.updated_at, u.username, u.display_name
    FROM submissions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.submitted_at DESC
  `).all();
  const result = rows.map(s => {
    const sels = db.prepare(
      "SELECT row_idx, delivery_point FROM submission_selections WHERE submission_id = ?"
    ).all(s.id);
    let fip = 0, almarai = 0, field = 0;
    sels.forEach(r => {
      if (r.delivery_point === "FIP") fip++;
      else if (r.delivery_point === "Almarai") almarai++;
      else field++;
    });
    return {
      id: s.id,
      name: s.responder_name,
      desig: s.responder_desig,
      region: s.responder_region,
      submittedAt: s.submitted_at,
      updatedAt: s.updated_at,
      account: s.username,
      displayName: s.display_name,
      assigned: sels.length,
      fip, almarai, field,
      selections: sels
    };
  });
  return res.json({ submissions: result });
});

app.get("/api/report", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, role, display_name FROM users ORDER BY id").all();

  const report = users.map((u) => {
    const profile =
      db
        .prepare("SELECT responder_name, responder_desig, responder_region, responder_date FROM planner_profiles WHERE user_id = ?")
        .get(u.id) || {};
    const rows = db
      .prepare("SELECT row_idx, delivery_point FROM planner_selections WHERE user_id = ?")
      .all(u.id);
    return {
      user: {
        id: u.id,
        username: u.username,
        role: u.role,
        displayName: u.display_name || u.username
      },
      profile: {
        name: profile.responder_name || "",
        desig: profile.responder_desig || "",
        region: profile.responder_region || "",
        date: profile.responder_date || ""
      },
      selections: rows
    };
  });

  return res.json({ report });
});

app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, displayName } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "username, password, role are required." });
  }
  if (!["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "role must be admin or user." });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role, display_name, is_active) VALUES (?, ?, ?, ?, 1)")
      .run(username.trim(), hash, role, displayName || username.trim());
    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (error) {
    return res.status(409).json({ error: "User already exists." });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = db
    .prepare(`
      SELECT id, username, role, display_name, is_active, created_at
      FROM users
      ORDER BY id
    `)
    .all();
  return res.json({ users });
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { displayName, role, isActive, password } = req.body || {};
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const target = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
  if (!target) {
    return res.status(404).json({ error: "User not found." });
  }
  if (id === req.session.user.id && isActive === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account." });
  }

  if (role && !["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "role must be admin or user." });
  }

  const updates = [];
  const params = [];
  if (typeof displayName === "string") {
    updates.push("display_name = ?");
    params.push(displayName.trim() || target.username);
  }
  if (role) {
    updates.push("role = ?");
    params.push(role);
  }
  if (typeof isActive === "boolean") {
    updates.push("is_active = ?");
    params.push(isActive ? 1 : 0);
  }
  if (typeof password === "string" && password.trim()) {
    updates.push("password_hash = ?");
    params.push(bcrypt.hashSync(password.trim(), 10));
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No updates provided." });
  }

  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Onboarding app listening on port ${PORT}`);
});
