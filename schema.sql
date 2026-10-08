-- Trader Co-Pilot — Cloudflare D1 schema
-- Run this once against your D1 database before first deploy (see README.md).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT PRIMARY KEY,
  trades TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  custom_strategies TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Per-user session observations / personal session playbook.
CREATE TABLE IF NOT EXISTS user_session_notes (
  user_id TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Failed-login counter for basic brute-force protection.
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

-- Blog posts written by admins (ADMIN_EMAILS env var) and read by all traders.
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  author_id TEXT,
  author_name TEXT,
  read_minutes INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_blog_status_pub ON blog_posts (status, published_at);

-- Last activity per trader (shown to admins/mentors in the Admin dashboard).
CREATE TABLE IF NOT EXISTS user_activity (
  user_id TEXT PRIMARY KEY,
  last_seen_at TEXT,
  last_save_at TEXT,
  saves INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0
);

-- Quote of the Day (admin) + devices that want notifications + app settings (VAPID keys).
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_ok_at TEXT, fails INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Admin announcements shown on the dashboard (and optionally pushed as notifications).
CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', cta TEXT NOT NULL DEFAULT '', style TEXT NOT NULL DEFAULT 'info', created_at TEXT NOT NULL, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1, notified INTEGER NOT NULL DEFAULT 0, created_by TEXT);

-- 🏆 Competition (Discipline Challenge): created by admin, anonymous entries, claps.
CREATE TABLE IF NOT EXISTS competitions (id TEXT PRIMARY KEY, title TEXT NOT NULL, strategy TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '[]', entry_criteria TEXT NOT NULL DEFAULT '', exit_criteria TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL, end_date TEXT NOT NULL, criteria TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', results TEXT, reveal_names INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT, prize_weekly TEXT NOT NULL DEFAULT '', prize_final TEXT NOT NULL DEFAULT '', week_results TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS competition_entries (id TEXT PRIMARY KEY, competition_id TEXT NOT NULL, user_id TEXT NOT NULL, alias TEXT NOT NULL, trade_id TEXT NOT NULL, trade TEXT NOT NULL, rules_checked TEXT NOT NULL DEFAULT '[]', image TEXT NOT NULL DEFAULT '', score REAL NOT NULL DEFAULT 0, breakdown TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, image_src TEXT NOT NULL DEFAULT '', day TEXT NOT NULL DEFAULT '', rr REAL, rules_part REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok', admin_note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', UNIQUE(competition_id, trade_id, user_id));
CREATE INDEX IF NOT EXISTS idx_comp_entries ON competition_entries (competition_id, created_at);
CREATE TABLE IF NOT EXISTS competition_claps (entry_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (entry_id, user_id));
