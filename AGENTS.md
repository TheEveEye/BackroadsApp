# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React + TypeScript app.
  - `src/routes/` holds page-level routes (e.g., `src/routes/BridgePlanner.tsx`).
  - `src/components/` holds reusable UI and map components.
  - `src/workers/` holds web workers (route computation).
  - `src/lib/` holds data loaders and graph utilities.
- `public/` contains static assets.
  - `public/icons/` for UI icons, `public/ships/` for ship icons.
  - `public/data/` for JSON data files consumed by the app.
- `docs/` mirrors some data for documentation.
- Build outputs land in `dist/` or `build/` (depending on script).

## Build, Test, and Development Commands
- `npm run dev` — start Vite dev server.
- `npm run build` — typecheck with `tsc -b` and build with Vite.
- `npm run preview` — preview the production build locally.
- `npm run lint` — run ESLint across the codebase.
- `npm run deploy` — build and publish to GitHub Pages (also copies `index.html` to `404.html`).

## Coding Style & Naming Conventions
- TypeScript + React (function components, hooks).
- Indentation: 2 spaces; semicolons enabled.
- Naming: components in `PascalCase`, hooks and helpers in `camelCase`.
- Styling: Tailwind utility classes; keep class strings readable and grouped.
- Prefer descriptive inline constants over magic numbers (e.g., map sizes, ranges).

## Testing Guidelines
- No automated test framework is configured.
- Validate manually via `npm run dev` and spot-check key flows (routing, map rendering, worker responses).

## Commit & Pull Request Guidelines
- Recent commits use short, imperative messages (e.g., “Add bridge range preset popover”).
- Keep commits focused; include a concise summary and any relevant UI notes.
- PRs should include a short description and screenshots for UI changes when applicable.

## Notes & Configuration
- Icons resolve via `src/components/Icon.tsx` from `public/icons/`.
- Ship images resolve from `public/ships/`.
- Web workers live under `src/workers/` and are loaded via Vite `new URL(...)` syntax.
