# Trader Co-Pilot — Analysis Upgrade

## Daily & Session Analysis
- Premium session performance cards for Sydney, Tokyo, London and New York.
- Shows selected-day trades, wins/losses, win rate, P&L and average R.
- Shows journal-wide session totals for context and sample size.
- Hourly performance remains available for the selected date.
- Added persistent “My Session View” notes for every session.
- Traders can write observations such as volatility, structure, news sensitivity, execution quality, etc.
- Session observations are stored per user in a dedicated D1 table: `user_session_notes`.
- Added responsive mobile layout.

## Important
Run the updated `schema.sql` once if deploying from scratch. The API also creates `user_session_notes` automatically if it does not exist.
