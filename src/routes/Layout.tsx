import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { loadData, type GraphData } from '../lib/data';
import { AuthStatus } from '../components/AuthStatus';

type AppWindow = Window & {
  appGraph?: GraphData;
};

export function Layout() {
  const location = useLocation();
  const baseUrl = import.meta.env.BASE_URL || '/';
  // Dynamic titles per route
  useEffect(() => {
    const base = 'Backroads';
    const p = location.pathname;
    if (p.startsWith('/scanner')) document.title = `${base} | Drifter Scanner`;
    else if (p.startsWith('/observatories')) document.title = `${base} | Observatories`;
    else if (p.startsWith('/bridge-planner')) document.title = `${base} | Bridge Planner`;
    else document.title = base;
  }, [location.pathname]);
  // Globally load data so routes like Scanner work on direct entry
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const appWindow = window as AppWindow;
        if (appWindow.appGraph) return;
        const data: GraphData = await loadData();
        if (!cancelled) {
          appWindow.appGraph = data;
          try {
            window.dispatchEvent(new CustomEvent('graph-loaded'));
          } catch {
            // Non-browser-compatible environments can skip the notification.
          }
        }
      } catch {
        // Routes that depend on data will handle their own error states.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-white dark:from-gray-950 dark:to-black">
      <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/80 dark:bg-black/40 border-b border-slate-200/70 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <Link to="/" className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-semibold text-lg sm:justify-self-start">
            {/* Use BASE_URL-aware path for GitHub Pages compatibility */}
            <img
              src={`${baseUrl}backroads.png`}
              alt="Backroads"
              className="w-6 h-6 rounded"
            />
            Backroads
          </Link>
          <nav className="flex flex-wrap items-center gap-1 sm:gap-2 justify-start sm:justify-center sm:justify-self-center">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                Home
              </NavLink>
              <NavLink
                to="/observatories"
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                Observatory Finder
              </NavLink>
              <NavLink
                to="/bridge-planner"
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                Bridge Planner
              </NavLink>
              <NavLink
                to="/scanner"
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                Drifter Scanner
              </NavLink>
          </nav>
          <div className="flex items-center justify-start sm:justify-end sm:justify-self-end">
            <AuthStatus />
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200/70 dark:border-slate-800">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
          <p>
            &copy; 2014 CCP hf. All rights reserved. &quot;EVE&quot;, &quot;EVE Online&quot;, &quot;CCP&quot;, and all related logos and images are trademarks or registered trademarks of CCP hf.
          </p>
          <p className="mt-1">
            This material is used with limited permission of CCP Games. No official affiliation or endorsement by CCP Games is stated or implied.
          </p>
        </div>
      </footer>
    </div>
  );
}
