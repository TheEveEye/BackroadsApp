import { useAuth } from '../components/AuthProvider';

export function AuthCallback() {
  const { status, error } = useAuth();

  return (
    <section className="max-w-xl mx-auto">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">EVE Online Sign In</h1>
        {status === 'loading' && (
          <p className="text-slate-600 dark:text-slate-300">Completing authentication...</p>
        )}
        {status === 'error' && (
          <p className="text-red-600 dark:text-red-400">{error || 'Login failed. Please try again.'}</p>
        )}
        {status === 'authenticated' && (
          <p className="text-slate-600 dark:text-slate-300">Signed in. Redirecting...</p>
        )}
        {status === 'idle' && (
          <p className="text-slate-600 dark:text-slate-300">Waiting for authentication response...</p>
        )}
      </div>
    </section>
  );
}
