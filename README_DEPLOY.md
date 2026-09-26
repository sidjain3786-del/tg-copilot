# Trader Co-Pilot — Complete Cloudflare Pages Build

## Structure
- `index.html`, `app.js`, `style.css` — frontend
- `functions/api/*` — Cloudflare Pages API routes
- `functions/_lib/auth.js` — shared authentication helpers
- `schema.sql` — D1 schema
- `manifest.webmanifest`, `sw.js`, icons — PWA

## Cloudflare Pages
- Framework preset: None
- Build command: `exit 0`
- Build output directory: `.`
- D1 binding: `DB` -> your D1 database

Deploy this folder as the project root. The `/api/*` routes are automatically handled by Pages Functions.
