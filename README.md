## Backroads (EVE Online)

Backroads is a client-side navigation toolset for EVE Online. It includes observatory finding, route scanning, and bridge planning with Ansiblex and cyno-beacon aware workflows.

Live app: https://backroads.kiwiapps.dev

### Features

- Jove Observatory finder with autocomplete system search and jump-distance filtering
- Scanner route planning with optional Ansiblex support
- Bridge planner with ship-range presets, one- and two-bridge routing, blacklist support, and optional Ansiblex traversal
- Cyno beacon management in the bridge planner, including manual add/remove plus clipboard import/export
- Map views for explored frontiers and bridge routes, including route overlays and bridge/beacon indicators

### Tech stack

- React + TypeScript + Vite
- Tailwind CSS

## Quick start (development)

Prerequisites: Node.js 18+ and npm.

1) Install dependencies

```bash
npm install
```

2) Start the dev server

```bash
npm run dev
```

Vite will print a local URL (typically http://localhost:5173). Open it in your browser.

## Build and preview

```bash
npm run build    # builds to ./build
npm run preview  # serves the production build locally
```

## Deploy to GitHub Pages

This repo is configured to deploy a static build to GitHub Pages using the `gh-pages` branch and a custom domain.

```bash
npm run deploy
```

Notes:
- The app base path is `/` in `vite.config.ts` and `homepage` in `package.json` points to the custom domain. If you change the domain, update both.
- The deploy script writes a `CNAME` for `backroads.kiwiapps.dev` via `gh-pages --cname`.
- Pages should be configured to serve from the `gh-pages` branch (root).

## Data files

All data is loaded client-side from `public/data`:

- `systems_index.json` (required)
- `system_names.json` (optional; improves name lookup)
  - Shape: `{ byId: Record<string,string>, byName: Record<string, number> }`
- `region_names.json` (optional; shows region names)
  - Shape: `{ byId: Record<string,string> }`

If `systems_index.json` is missing, the app will show an error on load.

## Assets

- `public/icons` contains UI icon assets used by `src/components/Icon.tsx`
- `public/eve` contains EVE-specific PNG assets, including ship icons and `cynosuralBeacon.png`

## License

MIT
