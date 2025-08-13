import { Link } from 'react-router-dom';

export function Home() {
  return (
    <section className="grid gap-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Welcome to Backroads</h1>
        <p className="text-slate-600 dark:text-slate-300">Choose a tool to get started.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Observatory Finder card */}
        <Link to="/observatories" className="group relative block rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.15),transparent_35%)] opacity-70" />
          <div className="relative p-6">
            <h2 className="text-2xl font-semibold mb-1">Observatory Finder</h2>
            <p className="opacity-95">Find nearby Jove Observatories with gates, Ansiblex, and Titan range.</p>
            <div className="mt-4 inline-flex items-center gap-2 text-white/90 group-hover:translate-x-0.5 transition-transform">
              <span className="text-sm font-medium">Open</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </Link>

        {/* Wormhole Scanner card */}
        <Link to="/scanner" className="group relative block rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow hover:shadow-md transition-shadow">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.25),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.15),transparent_35%)] opacity-70" />
          <div className="relative p-6">
            <h2 className="text-2xl font-semibold mb-1">Wormhole Scanner</h2>
            <p className="opacity-95">Record and share scanned Observatory wormholes with types and status.</p>
            <div className="mt-4 inline-flex items-center gap-2 text-white/90 group-hover:translate-x-0.5 transition-transform">
              <span className="text-sm font-medium">Open</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
