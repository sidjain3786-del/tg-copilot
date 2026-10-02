# Trader Co-Pilot — Bug-fix release (Oct 2026)

## One-time setup for this release
1. **Create an R2 bucket** (Cloudflare dashboard → R2 → Create bucket), e.g. `tgcopilot-images`.
2. **Bind it to the Pages project**: Pages project → Settings → Bindings → Add → R2 bucket
   → Variable name **`IMAGES`** → select the bucket. (Add it for Production and Preview.)
3. **Run the updated `schema.sql`** once on D1 (adds the `login_attempts` table).
   The API also creates it automatically if missing.
4. Redeploy. Existing base64 screenshots are moved to R2 automatically the next time the user saves anything.

If `IMAGES` is not bound, the app still works exactly as before (images stay inside D1),
but large journals will hit D1's 2 MB row limit — the server now returns a clear error message instead of a raw failure.

## What was fixed
- Session cards showed "undefined% win / Avg R undefined".
- Chart screenshots now go to R2 (`/api/upload`, `/api/img/...`) — fixes "every save fails" after ~6–12 screenshots. Users can only read their own images.
- Risk Center used the UTC date: "Today" was wrong from 00:00–05:30 IST. Now uses the device's local date; week starts Monday local time.
- Date-only (old) trades no longer counted as 05:00 / Sydney+Tokyo trades.
- Saving with missing fields (old cached app) no longer wipes notes, strategies or session notes.
- Session note shows "⚠ Not saved" when the save actually fails.
- Risk calculator: warns when the target is on the wrong side; position size is rounded DOWN to whole units; shows actual risk; pre-trade SL gate reacts to the calculator.
- Loss streak ordered by trade time, not logging time.
- Currency setting (₹ default, $, €, £, ¥) in Risk Center → Money Management; amounts formatted with 2 decimals max.
- Corrupted browser storage no longer crashes the app on startup.
- API: malformed/corrupted JSON returns 400 / safe defaults instead of crashing; size check with clear message.
- Signup validates email and name length; login rate-limited (8 failures / 15 min per email); constant-time password compare; expired sessions cleaned up; schema check runs once per worker instead of every request.
- Note autosave really retries (2 retries); error alerts name what failed (Trade / Note / Session note); saves are queued so they can't overwrite each other out of order.
- Service worker cache bumped to v2 so users get the new app.js.

## Update 2 — Notes speed
- **＋ New Note opens instantly** (was waiting for the full journal to save first; ~1.5 s+ on slow networks, longer with big journals). It now shows immediately and saves in the background with "Saving… / ✓ Saved" and automatic retry.
- Saves send only what changed: a note save sends only notes, a trade save only trades, a session note only session notes (backend already supports partial updates).
- Screenshots start uploading to R2 the moment they're picked or drawn, and multiple images upload in parallel.
- Drawn/annotated images are now max 1400px JPEG (were full-size WEBP), roughly 3–5× smaller.
- Adding a strategy, saving a note form and deleting a note no longer freeze the screen while saving.

## Update 3 — New look ("Ink & Marigold")
- New `theme.css` (loaded after `style.css`): deep ink header and hero, marigold for actions and XP, green/red kept only for money.
- Fonts: Bricolage Grotesque (headings, big numbers) + IBM Plex Sans (text, tabular figures). Loaded from Google Fonts; falls back to system fonts offline.
- Dashboard hero now shows a greeting, today's P&L and how much of today's loss budget is used.
- Equity curve sorted by trade time, with area fill and a marker on the latest point.
- Motion: sliding tab indicator, short content transition on tab change, modal lift, risk bars fill in, one dashboard load moment (curve draws, numbers count up — once per visit), candle loader.
- `prefers-reduced-motion` respected; animations can never break rendering (fail-safe).
- App icons and PWA theme colour updated to the new palette. Service worker cache bumped to v3.

## Update 4 — Trade history completeness
- **Quick note now shows in every history view** (Grid, List, Gallery — before it was only in Detailed). Shown as a highlighted note on the card; search finds it.
- Log form quick note is now multi-line.
- **Edit Trade** can now change: quick note, trade date & time, strategy, mistake, execution quality (before these could not be edited). "Plan followed" is recalculated after editing.
- Trade time shown properly everywhere (e.g. "1 Oct 2026, 11:05 am") instead of the raw logging timestamp; Grid view now shows time and SL.
- History sorted by actual trade time (backdated trades land in the right place).
- Search box: symbol, note, exit reason, strategy, emotion, mistake.
- Exit price removed in Edit → trade becomes "Open" and P&L/R reset to 0 (before it kept the old P&L).
- Mistake chip highlighted in red; exit reason shown as a chip; device/location shown in Detailed view.
- Grid and Gallery use multiple columns on wide screens.

## Update 5 — Setup Playbook on the dashboard
- New **Setup Playbook** card (below the KPIs): pick a strategy from the dropdown and see everything about it in one compact view. The choice is remembered on that device.
- **Numbers:** trades (open trades shown separately, not counted in stats), win rate, net P&L, avg R, % rules followed, best and worst session.
- **Rules:** entry criteria, exit/invalidation, mandatory rules. ✏️ Edit right there (works for old strategies that had no criteria too).
- **Mistakes in this setup:** each mistake with count and how much money it cost, plus "rules followed vs rules broken" P&L.
- **Notes:** notes whose Strategy (or concept) matches the setup, click to open; ＋ Note creates a note already linked to the setup; latest trade quick notes.
- **Latest trades:** last 5 trades of that setup; "Sab dekho" opens History filtered to it.
- Strategies that exist only in trades (e.g. "Bina Setup") are listed too.

## Update 6 — Manage strategies + notes linking
- The original "Add Strategy" section existed in the code but was never shown on any screen. Replaced by a **Manage strategies** window, opened from:
  Dashboard → Setup Playbook → "⚙️ Manage strategies", and Log Trade → Strategy → "⚙️ Manage" (or "＋ Add strategy" when there are none).
- In it: add, edit (name, entry criteria, exit/invalidation, rules) and delete strategies. Duplicate names are blocked.
  Renaming moves that strategy's trades and notes to the new name. Deleting a strategy never deletes its trades.
- Notes now link to a setup much more reliably:
  - Note editor's Strategy field is now a dropdown of your saved strategies (was free text, so small typos broke the link).
  - Matching ignores case/spaces/punctuation, accepts short forms ("orb" → "ORB Breakout"), and also picks up notes whose title names the strategy.
  - Setup Playbook has "🔗 Purana note is setup se jodo…" to attach any existing note in one tap.

## Update 7 — Strategy dropdown in notes
- Note editor → Strategy is a clear, larger dropdown of your saved strategies ("— Strategy chuno —").
- Last option "＋ Nayi strategy banao…" opens the strategy window; the new strategy is saved and linked to that note automatically. Closing the window without saving leaves the note unchanged.

## Update 8 — Broken images after R2: diagnosis + safety
- A broken image no longer shows a blank/broken icon. It shows the exact reason:
  - **R2 not connected** in this deployment (binding missing / not redeployed) → add `IMAGES` binding and redeploy.
  - **Image not in bucket** (binding now points to a different bucket) → bind the bucket the images were uploaded to.
  - **Session expired** → log in again.
  With "Retry" and "Sab images check karo" (calls new `GET /api/img-health`: binding present?, how many R2 images, how many found/missing, how many still inline).
- **Safer migration:** after uploading an old image to R2, the app now opens it back from R2 before replacing the inline copy. If it can't be read, the inline image is kept (nothing is lost).
- A single unsupported/oversized image no longer blocks saving; it simply stays inline. `image/jpg` data URLs are accepted.
- Image cache is cleared on logout (prevents one account's image links being reused in another).

### If images are already missing from R2
D1 Time Travel can roll the database back to a minute before the migration (Free plan: last 7 days, Paid: 30 days):
`npx wrangler d1 time-travel restore <DB_NAME> --timestamp=<UNIX_TIME_BEFORE_MIGRATION>`
This restores the WHOLE database (trades/notes saved after that time are rolled back too). The command prints a bookmark to undo the restore.

## Update 9 — Old images blinking
- **Cause (app bug):** when an image failed to display but the server still answered "OK", the broken-image helper reloaded it again and again (~50 requests/second) → images blinked. Now an image is retried at most once, then a clear message is shown. In a test with 3 damaged files: 206 requests in 4 s before, 4 after.
- The app now checks that a file really decodes as an image, not just that the server answered.
- **Self-repair on the server:** if a file in R2 contains the image as base64 / data-URL text instead of real image bytes, `/api/img` decodes it, serves it correctly and saves the fixed file back to R2.
- Files that are truly unreadable show: "R2 mein is image ki file kharab hai — Edit se hata kar dobara upload karo". "Sab images check karo" now also counts damaged files.

## Update 10 — "Image baar-baar load nahi ho rahi" (stale browser cache)
- **Cause:** earlier builds served `/api/img/...` with `Cache-Control: immutable` for 1 year. Browsers that had once received a bad copy of an image kept showing that bad copy even after the server copy was fixed. (Health check showed 13/13 found, 0 damaged — the server side was fine; only the browser copy was stale.)
- **Fix:** images are now displayed with a version tag (`?v=3`), so every browser fetches a fresh copy once. Stored data keeps the plain URL. If one copy still fails, the app fetches a fresh one, remembers the working URL and reuses it when the screen re-renders (notes autosave, typing etc.). Server cache is now 1 day, not 1 year/immutable.
- Verified in the same browser profile that had the stale copies: before → all images broken with this message; after → all valid images show.
