import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { loadData, type GraphData } from '../lib/data';
import { AuthStatus } from '../components/AuthStatus';
import { Icon } from '../components/Icon';

type AppWindow = Window & {
  appGraph?: GraphData;
};

const FOOTER_COLLAPSED_STORAGE_KEY = 'br.footer.collapsed.v1';

function loadFooterCollapsed() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FOOTER_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function Layout() {
  const location = useLocation();
  const baseUrl = import.meta.env.BASE_URL || '/';
  const [footerCollapsed, setFooterCollapsed] = useState(loadFooterCollapsed);
  // Dynamic titles per route
  useEffect(() => {
    const base = 'Backroads';
    const p = location.pathname;
    if (p.startsWith('/scanner')) document.title = `${base} | Drifter Scanner`;
    else if (p.startsWith('/observatories')) document.title = `${base} | Observatories`;
    else if (p.startsWith('/bridge-planner')) document.title = `${base} | Bridge Planner`;
    else if (p.startsWith('/sovereignty-planner')) document.title = `${base} | Sovereignty Planner`;
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

  useEffect(() => {
    try {
      localStorage.setItem(FOOTER_COLLAPSED_STORAGE_KEY, String(footerCollapsed));
    } catch {
      // Browser storage can be unavailable in private or restricted contexts.
    }
  }, [footerCollapsed]);

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
                to="/sovereignty-planner"
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs sm:text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                Sovereignty Planner
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
      <main className="flex min-h-0 w-full max-w-screen-2xl flex-1 flex-col mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
      {footerCollapsed ? (
        <div className="group fixed inset-x-0 bottom-0 z-30 h-2 transition-[height] hover:h-10 focus-within:h-10">
          <div className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-white/95 to-transparent pb-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:from-black/95">
            <button
              type="button"
              onClick={() => setFooterCollapsed(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1 text-xs text-slate-600 shadow-sm hover:bg-slate-50 hover:text-slate-800 focus:opacity-100 dark:border-slate-700 dark:bg-gray-900/95 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-expanded="false"
            >
              <Icon name="chevron-down" size={12} className="rotate-180" />
              Show footer
            </button>
          </div>
        </div>
      ) : (
        <footer className="shrink-0 border-t border-slate-200/70 dark:border-slate-800">
          <div className="relative max-w-screen-2xl mx-auto px-4 pt-10 pb-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400 sm:px-28 sm:py-4">
            <button
              type="button"
              onClick={() => setFooterCollapsed(true)}
              className="absolute right-4 top-2 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 sm:right-6"
              aria-expanded="true"
            >
              Hide footer
              <Icon name="chevron-down" size={12} />
            </button>
            <p>
              &copy; 2014 CCP hf. All rights reserved. &quot;EVE&quot;, &quot;EVE Online&quot;, &quot;CCP&quot;, and all related logos and images are trademarks or registered trademarks of CCP hf.
            </p>
            <p className="mt-1">
              This material is used with limited permission of CCP Games. No official affiliation or endorsement by CCP Games is stated or implied.
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}
