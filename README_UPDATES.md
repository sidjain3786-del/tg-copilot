# Trader Co-Pilot — Journal & Notes Intelligence Upgrade

## Included
- Notes upgraded into a personal learning library with categories:
  - Concepts
  - Strategies
  - Mistakes
  - My Rules
  - Market Observations
  - Reviews
- Actionable Rule field on every note.
- "Turn this learning into a rule" action in the reading view.
- My Rules strip showing rules extracted from the user's own notes.
- Review & Trading Leaks tab with:
  - 7-day activity
  - clean setup rate
  - preventable-loss count
  - mistake/leak patterns
  - process insight
  - strategy review
  - next-session 3-question checklist
- Existing Reality Check remains merged at the top of Trade History.
- Existing Grid / List / Detailed / Gallery history views remain.
- Emotion remains compulsory in Trade Log.
- Confidence slider is removed; edit trade also has no confidence field.
- Edit Trade now updates emotion, exit reason, quick note, mistake, quality and screenshots.
- No D1 schema migration required: new note metadata is stored inside the existing JSON `notes` field.

## Validation
- `node --check app.js` passes.
- Existing API files and D1 schema are preserved.
- No image storage architecture was changed in this upgrade.
