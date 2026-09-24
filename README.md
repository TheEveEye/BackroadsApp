## Backroads (EVE Online)

Backroads is a client-side navigation toolset for EVE Online. It includes observatory finding, route scanning, and bridge planning with Ansiblex and cyno-beacon aware workflows.

Live app: https://backroads.kiwiapps.dev

### Features

- Jove Observatory finder with autocomplete system search and jump-distance filtering
- Drifter Scanner route planning with optional Ansiblex support
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
npm test         # rules, directed routing, persistence formats, and ESI handling
```

## Ansiblex zone planning

Use the **Ansiblexes** slider in Bridge Planner to choose Off or a maximum destination zone from 1–5. Zone 5 allows all zones. Each direction uses the departure gate owner's capital, so returns from farther zones into allowed zones remain available. Unknown-zone links remain available with zone warnings at Zone 5 and are omitted at lower ceilings. The **Configure…** button beside the slider opens the link editor, including clipboard import/export, even while Ansiblexes are off.

The map shows translucent, irregular areas around systems, colored green, teal, blue, violet and magenta for Zones 1–5. Cached bounded Voronoi cells use the existing map projection, while classification uses all three spatial coordinates. Adjacent cells in the same zone share a fill without internal grid lines. These areas group systems by distance to the displayed alliance's capital, not sovereignty borders. System tooltips identify the zone, distance and reference capital.

**Show zones** hides the overlay without changing routing. The map's **Fit map** button frames the route when one is available, or the capital with a 25-LY margin when there is no route. Zone filtering preserves pan and zoom. The map can display zones before any route is entered and after searches with no results. If a current capital is unavailable, it explains the missing context instead of drawing assumed zones.

The alliance and capital default to the sovereignty holder of a majority of distinct, enabled Ansiblex endpoints, using public ESI data. If no alliance holds a majority, the signed-in character's alliance provides the fallback. The map keeps cached zones visible during refresh, with their age shown in the legend; cached ownership never establishes current routing access. Without a network or character capital, it asks for a network or sign-in. There is no Advanced configuration; previously saved fleet, charge and ownership overrides no longer affect the planner. Self-jump presets still determine ship eligibility automatically; Titan Bridge and Carrier Conduit do not classify passengers as capitals.

Zones use unrounded 3D distances: ≤5, ≤10, ≤15, ≤20, and >20 LY. Known ship, ownership, and sovereignty incompatibilities exclude the affected direction. Zone filtering preserves the existing route ranking and bridge budgets.

Public ESI sovereignty data supplies alliance ownership and capital locations, cached for up to five minutes. Expired data does not determine current routing ownership or zones; the map may display it as a labeled cached reference.

The link editor retains JSON and tabular network imports, including links from earlier versioned planner exports. JSON preserves enabled and directional flags. Zone preferences live separately in `br.bridgePlanner.ansiblex.v1`, alongside the existing shared link settings. Older settings default to `maxZone: 5` and `showZoneOverlay: true`; link imports leave zone preferences intact.

The initial `public/data/ansiblex_rules.json` catalog was checked against live ESI type dogma. Its provenance records that source explicitly. To replace it with a current SDE-derived catalog without rewriting universe data:

```bash
npm run build:data -- --ansiblex-only --force-download
```

The generator reads activation-cost attribute 6364 and capacitor-capacity attribute 482, converting GJ to TJ, and records the SDE build. It rejects a pre-update SDE or class costs that differ by hull. Zone multipliers and eligibility are versioned release rules and must be reviewed when CCP changes them.

Sources: [September patch notes](https://www.eveonline.com/news/view/patch-notes-version-24-01), [CCP cost explanation](https://www.eveonline.com/news/view/force-projection-ansiblex-capacitor-update), [ESI schema](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-05-19). Before deploying, verify exact zone-boundary behavior against the game client; continuous bands are the documented implementation assumption.

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

- `systems_index.json` (required; includes each system's 3D `position`, schematic `position2D`, aggregated `power` and `workforce`, and total hourly `magmaticGas` and `superionicIce` Skyhook output across its planets)
- `system_names.json` (optional; improves name lookup)
  - Shape: `{ byId: Record<string,string>, byName: Record<string, number> }`
- `constellation_names.json` (optional; provides names for constellation-level selection)
  - Shape: `{ byId: Record<string,string> }`
- `region_names.json` (optional; shows region names)
  - Shape: `{ byId: Record<string,string> }`

If `systems_index.json` is missing, the app will show an error on load.

Regenerate these files from CCP's latest SDE JSONL export with:

```bash
npm run build:data
```

## Assets

- `public/icons` contains UI icon assets used by `src/components/Icon.tsx`
- `public/eve` contains EVE-specific PNG assets, including ship icons and `cynosuralBeacon.png`

## License

MIT
