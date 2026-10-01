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
