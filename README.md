# The Nephews — Mobile Softball Stat Tracker

A dependency-free, mobile-first Progressive Web App for the Nephews men's softball team.

## Run it locally

Because the app uses a service worker, serve the folder over HTTP rather than opening `index.html` directly.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## GitHub Pages

Upload the files in this folder to the root of a GitHub repository, then enable **Settings → Pages → Deploy from a branch → main → /(root)**.

## Features

- Persistent roster and fill-in tracking
- Active-roster lineup builder with direct add controls
- Rapid lineup changes and substitutions
- One-tap batting outcomes, RBI and run tracking
- Inning-by-inning scoring for both teams
- Sortable career stat table
- Automatic Player of the Game after every completed game, with manual override
- Automatically generated postgame writeup highlighting the score and top performances
- Saved game recaps in game history with copy/regenerate controls
- Excel export including Player of the Game and Game Recap columns
- JSON backup/import
- Light-blue Nephews theme
- PWA/offline support

All data is stored in browser localStorage on the device.
