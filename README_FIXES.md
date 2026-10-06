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

## Update 11 — Image links, full screen viewer, eraser fix
- **Image from a link** (Notes → ＋ Add → 🔗 link box, Log Trade → link box, old note form): paste a TradingView snapshot link (`tradingview.com/x/...`), a direct image link, or a page with a preview image. New endpoint `POST /api/fetch-image` downloads it and stores its own copy in R2 (or inline if R2 isn't bound), so the image keeps working even if the original link dies. Enter key works. Private/local addresses are blocked; max 8 MB.
- **Full screen** button in the image popup (⛶ Full screen / 🗗 Exit full screen). Uses the browser's full-screen mode; on iPhone falls back to a full-screen layout. Drawing keeps working and lines up correctly in full screen. Closing the popup also exits full screen.
- **Eraser fixed:** the eraser used to cut holes into the chart itself, so erased areas were saved as black patches. Drawing now lives on its own layer: the eraser only removes drawing, the chart underneath stays intact (verified pixel-by-pixel: old method saved black `0,1,0`, new saves the original chart colour).
- **Drawing on trade screenshots now saves** (before, "Save Drawing" from History did nothing). The original screenshot and strokes are kept, so re-opening lets you edit; clearing all drawing and saving restores the original.
- Popups opened just for viewing (e.g. log-form preview) hide the drawing tools.

## Update 12 — Weekly report (PDF download)
- **📄 Weekly report** button on the dashboard (under "Log New Trade") and in Trade History.
- Pick the week (Mon–Sun) with ‹ Pichhla / Agla ›; a quick summary shows before downloading.
- The PDF contains: summary (net P&L, trades, win rate, avg R, profit factor, rules followed, avg win/loss, change vs last week), equity curve, day-by-day P&L, by strategy, discipline (rules followed vs broken), mistakes and their cost, emotions, sessions, best/worst trade, the full trade list, trade notes, and (optional) chart screenshots.
- File name: `Trading-Report_<monday>_to_<sunday>.pdf`. On an iPhone home-screen app the PDF opens in the viewer to save/share.
- PDF library (jsPDF + AutoTable, MIT) is bundled in `/vendor` and loaded only when a report is made — no outside CDN needed; it is cached for offline use.
- Built-in PDF fonts can't print ₹ or emoji: amounts show as "Rs", emoji are removed from notes in the PDF.

## Update 13 — Zoom, pan and a proper full-screen fit for chart images
- **Whole image always fits:** the picture is sized to the visible area in the popup and in full screen (on phones too); small images are enlarged in full screen. On phones the popup itself is full-screen and the toolbar is a single swipeable row, so the chart gets most of the screen.
- **Pinch to zoom (two fingers) no longer draws.** Two fingers zoom and move the picture; the half-started line from the first finger is thrown away. After zooming, one finger draws exactly where you touch.
- **✋ Move tool** to drag the picture with one finger/mouse. With an Apple Pencil, the Pencil draws and the finger moves the picture automatically.
- **Zoom controls** on the picture: − / 100% (tap to fit) / +. Mouse wheel / trackpad pinch zooms on laptops (up to 800%).
- Pen size now means the thickness you see on screen, at any zoom, so you can write small notes while zoomed in; lines stay in the right place on the saved image.
- In view-only popups one finger simply moves the picture.

## Update 14 — Voice typing (🎤)
- 🎤 button on every text block in Notes, on the Log Trade quick note and on the Edit Trade quick note. Tap, speak, words are typed where the cursor is (like the keyboard mic). Tap again or "Stop" to finish.
- What you're saying shows live in a small bar at the bottom; only the final words go into the note, then it autosaves.
- Spoken commands: "full stop" → . · "comma" → , · "question mark" → ? · "new line" / "next line" → new line. Sentences start with a capital letter automatically.
- Language button in the bar: **EN/Hinglish** (default, Latin letters like your notes) ⇄ **हिंदी** (Devanagari). Choice is remembered.
- Keeps listening through pauses (Android stops after silence; the app restarts it) for up to 5 minutes.
- Clear messages for: mic permission denied, no speech, no internet, browser not supported (Firefox — use the keyboard mic there).
- Uses the browser's built-in speech recognition (Chrome/Edge/Android/Safari). Needs internet and mic permission; audio is processed by the browser's speech service (Google in Chrome).

## Update 15 — Blog for traders
### One-time setup
1. Cloudflare dashboard → your Pages project → **Settings → Variables and Secrets** → add `ADMIN_EMAILS` = the admin's login email (several: comma-separated, e.g. `a@x.com, b@y.com`). Add it for Production (and Preview if you use it).
2. Redeploy. The `blog_posts` table is created automatically (it is also in `schema.sql`).
3. The admin logs out and in once (or just reloads) — a **＋ New post** button appears in the 📰 Blog tab.

### What it does
- New **📰 Blog** tab (desktop tabs + phone bottom bar). Red dot / count when there are posts the trader hasn't seen.
- **Readers:** post cards with cover, date, read time, tags; search and tag filter; clean reading view (big readable text, tap images to zoom/full screen). Drafts are never shown to readers.
- **Admin editor:** title, short summary, tags, cover image (upload or link), and content blocks — Paragraph, Heading, Sub-heading, Image (upload or TradingView/image link), Bullet list, Quote, 💡 Tip box, Divider — with ↑ ↓ to reorder and ✕ to remove. Inline **bold**, *italic*, [link](https://…). Preview, Save draft, Publish, Update, Unpublish, Delete; warning before leaving with unsaved changes. View count per post.
- **Security:** only emails in `ADMIN_EMAILS` can create/edit/delete (server checks every request — 403 otherwise). Posts are stored as blocks, not HTML, so nothing typed can run as code (tested with `<script>` / `onerror` — shown as plain text).
- Blog images are stored in R2 under `blog/` and served at `/api/blog-img/...` so every trader can see them.
- New API: `GET/POST /api/blog`, `GET/PUT/DELETE /api/blog/<id>`, `POST /api/blog/upload`, `GET /api/blog-img/<file>`. `/api/me` and login now return `isAdmin`.

## Update 16 — Direct links
- `https://<your-site>/#admin` → opens the Blog post editor (admins only; others get the Blog with a message). Works even when logged out: log in and the editor opens.
- `https://<your-site>/#blog` → opens the Blog. Any tab works too: `#log`, `#notes`, `#history`, `#analysis`, `#risk`.

## Update 17 — Paste a whole article into the blog editor
- Blog editor → "📋 Poora article paste karke format karo": paste text (or pick a .txt / .md file) and press **Blocks banao**. It fills title, summary, tags and creates all blocks.
- Format: `# Title`, `Summary: …`, `Tags: a, b`, `## Heading`, `### Sub-heading`, `> quote`, `- list item` (also `•`, `1.`), `💡 tip` (or `Tip:`), `---` divider, `![caption](https://image-link)`, inline `**bold**`, `*italic*`, `[link](https://…)`. Plain text works too — every blank line starts a new paragraph.

## Update 18 — Admin dashboard (mentors see traders' progress)
- New **🛠️ Admin** tab, visible only to `ADMIN_EMAILS`. `https://<site>/#admin` now opens this dashboard (the blog editor is at `#blog/new` or Blog → ＋ New post).
- **Overview:** total traders, active today, active in 7 days, new this week, trades in 7 days, and how many have been away 7+ days.
- **Traders table:** last active, trades (total / this week), net P&L (total / 7 days), win %, rules % with ↑↓ trend vs last week, top mistake, notes. Search, sort, filters (Active, 7+ din se gayab, Naye, Rules < 60%, Loss mein, 0 trades) and CSV export.
- **Trader page (read-only):** KPIs, equity curve, 12-week journaling heatmap, strategies / mistakes (with money cost) / emotions, every trade with quick notes and chart screenshots, notes (opened read-only), and their playbook.
- **Transparency:** signup screen says mentors can see the journal; existing traders get a one-time "Aapka journal mentors ko dikhta hai" notice (Samajh gaya).
- Tracking: new `user_activity` table (last visit, last save, visit/save counts) — created automatically.
- Security: `/api/admin/*` returns 403 for non-admins; admins may open traders' chart images, traders still only their own.
- New files: `functions/_lib/stats.js`, `functions/api/admin/users/index.js`, `functions/api/admin/users/[id].js`.

## Update 19 — Admin: delete traders + design polish
- Checkbox on every trader (admins and yourself can't be selected), "select all" in the header, and a floating bar "N selected · 🗑️ Delete N".
- 🧹 **Khaali accounts** banner + filter: finds accounts with 0 trades and 0 notes (test / temporary sign-ups) and selects them in one tap.
- **Delete trader** button on a trader's page too.
- Safe confirmation: shows who will be deleted with their trade/note counts, warns if they have data, and asks you to type **DELETE** when deleting several or any account with data. Esc / Cancel backs out.
- Deleting removes the account, sessions, journal, session notes, activity, login attempts and their chart images in R2. The person can't log in any more.
- Server: `DELETE /api/admin/users/<id>`, `POST /api/admin/users/delete {ids}` (max 200); admin-only; refuses admin accounts and your own.
- Look: dark header, status pills (Aaj active / Active / Gayab / Inactive / Naya / Admin), avatars, rules progress bar, KPI icons; phone layout shows traders as compact cards; bottom bar fits 8 tabs.
- New files: `functions/_lib/admin-delete.js`, `functions/api/admin/users/delete.js`.

## Update 20 — Quote of the Day + phone notifications
- **Traders:** a "💬 Quote of the Day" card on the dashboard (under the hero) with a "Naya" badge, Copy and WhatsApp share. Button **🔔 Roz notification pao** turns on phone/desktop notifications for that device (tap 🔔 On to turn off).
  - Android / laptop (Chrome, Edge, Firefox): works in the browser or installed app.
  - iPhone: works only after "Add to Home Screen" (iOS 16.4+), opened from the home-screen icon — the app tells the user this.
- **Admin:** Admin tab → "💬 Quote of the Day": write the quote + author, keep "Sabko notification bhejo" ticked, **📣 Post karo**. Shows how many devices have notifications on, live sending progress, result, and past quotes (delete ✕).
- How it works: the server sends an empty Web Push "ping" to every subscribed device (in batches of 40, within Cloudflare limits); the service worker then fetches the newest quote and shows it. Expired devices are removed automatically. VAPID keys are created automatically on first use and stored in D1 — no setup needed.
- Security: only admins can post / notify (403 otherwise); deleting a trader also removes their devices.
- New files: `functions/_lib/push.js`, `functions/api/quotes/index.js`, `functions/api/quotes/[id].js`, `functions/api/quotes/notify.js`, `functions/api/push/index.js`. Tables `quotes`, `push_subscriptions`, `app_settings` are created automatically.

## Update 21 — New logo
- New mark: **pilot wings + candlestick** (Co-Pilot × trading) on the ink background, gold candle.
- Replaced everywhere: browser tab (SVG + 32px PNG), header, login screen, install prompt, home-screen icons (normal + Android "maskable" full-bleed), iPhone home-screen icon (`apple-touch-icon.png`), notification icon + monochrome Android badge (`badge-96.png`), and the Weekly report PDF header.
- Service worker cache bumped (v10) so phones pick up the new icon. Already-installed home-screen apps may keep the old icon until the app is reopened a few times or reinstalled (OS caches icons).

## Update 22 — Logo focused on mind & psychology
- New mark: a **brain split by a gold candlestick** — the trader's mind, with trading at its centre. Same ink & marigold colours.
- Replaces the pilot-wings logo in every place listed in Update 21 (same file names). Service worker cache bumped to v11 so the new icons load.

## Update 23 — Announcements + feature on/off switches
### Announcements
- Admin tab → **📢 Announcement** (next to Quote of the Day): ready templates (📝 Journaling reminder, 🛡️ Risk reminder, 📰 Naya blog, 🎉 Celebration), title, message, a button (Abhi journal karo / Notes / History / Blog / Analysis / Weekly report), style (Important / Info / Celebration), how long it shows (1 / 3 / 7 days / until removed), and "Sabko notification bhejo".
- Traders see it on the dashboard **beside the Quote of the Day** (below it on phones), can tap the button (e.g. opens Log Trade) or close it (×).
- Notifications: the phone notification shows the announcement title + message and opens the right tab when tapped. The service worker now asks `/api/notify/latest` what the last push was about (quote or announcement).
- Admin list shows live / ended announcements with how many devices got it; ✕ removes one.
### Feature switches
- Admin tab → **⚙️ Features on / off**: Risk Center, Analysis, Notes, History, Blog, Setup Playbook, Weekly report, Quote of the Day, Announcements, Voice typing. Switching off hides it for all traders instantly (tabs, buttons, cards; Risk also hides the dashboard loss-budget). Data is not deleted — switch back on any time.
- Admins still see everything (switched-off tabs show a red OFF tag) so you can check things.
- New files: `functions/_lib/settings.js`, `functions/api/settings.js`, `functions/api/announcements/index.js`, `functions/api/announcements/[id].js`, `functions/api/notify/latest.js`. Changed: `functions/api/quotes/notify.js`, `functions/_lib/auth.js`. Tables are created automatically.

## Update 24 — Log Trade: cleaner Quick Note
- Quick Note now has its own full-width row under "Trade Date & Time / Exit Reason" (was squeezed into a narrow third column with the 🎤 floating outside).
- 🎤 sits inside the note box (bottom-right); the box only stretches downward (min ~3 lines, max ~10) so dragging no longer breaks the layout.
