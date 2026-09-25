# Trader Co-Pilot

## Clean strategy version
This version ships with **no built-in trading playbooks**. ICT, Order Block, FVG, Liquidity Sweep, and other demo strategies have been removed from the UI.

Users create their own strategies from **Notes → ADD STRATEGY**. Saved custom strategies are stored in Cloudflare D1 through `/api/data` and appear in the Playbook Model and Trade Log strategy dropdowns.

The backend also removes the three legacy demo strategy names from `custom_strategies` when user data is loaded, while preserving user-created strategies.

## Cloudflare Pages
- Keep `functions/` and `schema.sql` in the project.
- Build command: `exit 0`
- Build output directory: `.`
- D1 binding: `DB` → `tgcopilotjournal`
