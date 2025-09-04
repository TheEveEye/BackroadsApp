## Jove Observatory Finder (EVE Online)

Find nearby Jove Observatories from any starting system within a chosen number of gate jumps. The app provides an autocomplete search for systems, a jump limit slider, a lightyear radius overlay on a simple map, and an option to exclude Zarzakh.

Live app: https://backroads.kiwiapps.dev

### Features

- Search for a start system (autocomplete by name)
- Set maximum gate jumps to explore
- Optional: exclude Zarzakh
- Map view of the explored frontier with a configurable LY radius overlay
- Results list with shortest paths to observatories

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

## License

MIT
