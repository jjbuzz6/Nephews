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
- Postgame bar/restaurant picks based on where you played, how the game ended, and what is still open when you get out
- Saved spots with per-day opening hours, kitchen close, travel time, price, and vibe tags
- Map-search fallbacks so the picks work even before you save a single spot
- Excel export including Player of the Game, Game Recap, and postgame spot columns
- JSON backup/import
- Light-blue Nephews theme
- PWA/offline support

All data is stored in browser localStorage on the device.

## Postgame spots

Add the team's regular bars and restaurants under **Settings → Postgame Spots**. Each spot stores the
field it serves, minutes from that field, price, opening hours for all seven days (including a kitchen
close time and after-midnight closes), which results it suits, and tags like TVs, pitchers, or late
kitchen.

Give a game a **first pitch time** and a **location**, and the app works out when you actually walk in —
first pitch + game length + pack-up + drive, or the real finish time once the game is logged as complete.
It then ranks your spots on whether they are open at that moment, how long you get before last call,
whether the kitchen is still serving, how far they are, and whether they fit a win, a loss, or a tie.
The pick is shown with its reasons, backups, the spots it ruled out and why, and you can override it.
With no spots saved yet, it falls back to map searches tuned to the result and the hour.
