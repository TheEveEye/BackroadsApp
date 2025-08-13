export function Home() {
  return (
    <section className="grid gap-6">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h1 className="text-3xl font-semibold mb-2">Welcome to Backroads</h1>
        <p className="text-slate-600 dark:text-slate-300">This is a temporary home screen. Use the navigation bar above to explore the Observatory Finder.</p>
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white shadow-sm">
        <h2 className="text-2xl font-medium mb-1">Observatory Finder</h2>
        <p className="opacity-90">Plot routes, visualize jump ranges, and include Ansiblex and Titan bridges.</p>
      </div>
    </section>
  );
}
