import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { loadData, type GraphData } from '../lib/data';

export function Layout() {
  const location = useLocation();
  // Dynamic titles per route
  useEffect(() => {
    const base = 'Backroads';
    const p = location.pathname;
    if (p.startsWith('/scanner')) document.title = `${base} | Scanner`;
    else if (p.startsWith('/observatories')) document.title = `${base} | Observatories`;
    else document.title = base;
  }, [location.pathname]);
  // Globally load data so routes like Scanner work on direct entry
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
  if ((window as any).appGraph) return;
        const data: GraphData = await loadData();
        if (!cancelled) {
          (window as any).appGraph = data;
          try { window.dispatchEvent(new CustomEvent('graph-loaded')); } catch {}
        }
      } catch {
  // ignore; routes that depend on data will handle their own error states
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-gray-950 dark:to-black">
      <header className="sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/80 dark:bg-black/40 border-b border-slate-200/70 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-semibold text-lg">
            <span className="inline-flex w-6 h-6 rounded bg-blue-600" />
            Backroads
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
            >
              Home
            </NavLink>
            <NavLink
              to="/observatories"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
            >
              Observatory Finder
            </NavLink>
            <NavLink
              to="/scanner"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 ${isActive ? 'text-blue-700 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}
            >
              Scanner
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
      <footer className="mt-10 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        © {new Date().getFullYear()} Backroads
      </footer>
    </div>
  );
}
