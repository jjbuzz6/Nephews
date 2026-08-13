# Lineup Ledger — Mobile Softball Stat Tracker

A dependency-free, mobile-first Progressive Web App for men's softball stat tracking.

## Run it

Because the app uses a service worker, serve the folder over HTTP rather than opening `index.html` directly.

### Python
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

### Install on phone
Deploy the folder to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.), open it in Safari/Chrome, then use **Add to Home Screen**.

## Included
- Persistent roster and fill-in tracking
- Rapid lineup editing and substitutions
- Current-batter workflow with one-tap outcomes
- RBI stepper and run tracking
- Undo last plate appearance
- Inning-by-inning scorekeeping for both teams
- Multiple games and completed-game history
- Career stat aggregation
- Customizable game innings and visible result buttons
- True `.xlsx` export generated in the browser (Career Stats, Roster, Games, Plate Appearances)
- JSON backup/import
- PWA/offline support after first load

All data is stored in browser localStorage on the device.
