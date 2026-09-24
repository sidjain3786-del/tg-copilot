# Trader Co-Pilot — Cloudflare Pages + D1 (Multi-User)

Plain HTML/CSS/JavaScript frontend + Cloudflare Pages Functions backend.
Each of your 25 members signs up with their own email/password; their trades,
notes, and custom strategies are stored privately in a Cloudflare D1
(SQL) database — nobody can see anyone else's data.

## Folder structure
```
public/            → the website (index.html, style.css, app.js)
functions/api/     → serverless API endpoints (signup, login, logout, me, data)
functions/_lib/     → shared auth helpers (password hashing, sessions)
schema.sql          → database tables to create once
```

## Deploy steps (one-time setup, ~10 minutes)

### 1. Create a D1 database
In the Cloudflare dashboard: **Workers & Pages → D1 → Create database**.
Name it e.g. `trader-copilot-db`.

Or with Wrangler CLI (`npm install -g wrangler`, then `wrangler login`):
```
wrangler d1 create trader-copilot-db
```

### 2. Run the schema
Paste the contents of `schema.sql` into the D1 dashboard's **Console** tab and run it,
or via CLI:
```
wrangler d1 execute trader-copilot-db --remote --file=./schema.sql
```

### 3. Create the Pages project
In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Upload assets** (or
connect a GitHub repo containing this folder). Upload the whole project folder
(it must include both `public/` and `functions/`).

Or via CLI, from this folder:
```
wrangler pages deploy public --project-name=trader-copilot
```
(Wrangler automatically picks up the sibling `functions/` folder for a Pages project.)

### 4. Bind the D1 database to your Pages project
In the Cloudflare dashboard: your Pages project → **Settings → Functions →
D1 database bindings → Add binding**.
- Variable name: `DB`  (must be exactly this — the code uses `env.DB`)
- D1 database: select `trader-copilot-db`

Save, then **re-deploy** (bindings only take effect on a fresh deployment —
trigger one from the dashboard's "Deployments" tab, "Retry deployment").

### 5. Done
Visit your `*.pages.dev` URL (or your custom domain once attached). Share this
link with your 25 members — each one clicks "Sign Up" and creates their own
account.

## How data is kept private
Every API call checks a secure, `HttpOnly` session cookie against the
`sessions` table, then only reads/writes that one user's row in `user_data`.
Passwords are never stored in plain text — they're hashed with PBKDF2
(100,000 iterations, unique salt per user) using the browser/Workers-native
Web Crypto API.

## Local testing (optional)
```
npm install -g wrangler
wrangler pages dev public --d1=DB=trader-copilot-db
```
