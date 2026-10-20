import { Logo } from './Logo';

/** Shown when the web app has no Supabase configuration, instead of failing with a blank page. */
export function SetupRequired() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-lg space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <Logo />
        <h1 className="text-lg font-semibold text-slate-900">Configuration needed</h1>
        <p className="text-sm text-slate-600">
          The web app does not know which Supabase project to use. Copy{' '}
          <code className="rounded bg-slate-100 px-1">apps/web/.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1">apps/web/.env.local</code>, set{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        </p>
        <p className="text-sm text-slate-600">See docs/SETUP.md for the full local setup.</p>
      </div>
    </div>
  );
}
