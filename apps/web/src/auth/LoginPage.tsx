import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Alert, Button, Field, Input } from '../components/ui';
import { backend } from '../lib/backend';
import { errorMessage } from '../lib/errors';
import { Logo } from '../app/Logo';
import { useAuth } from './AuthProvider';

const TITLES = { signin: 'Sign in', signup: 'Create an account', reset: 'Reset your password' } as const;
const SUBMIT = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' } as const;

export function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (session) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  function switchTo(next: typeof mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        await backend.auth.signIn(email, password);
      } else if (mode === 'reset') {
        await backend.auth.requestPasswordReset(email.trim());
        setNotice('If an account exists for that email, we sent a link to choose a new password.');
      } else {
        const { needsConfirmation } = await backend.auth.signUp(email, password, displayName.trim());
        if (needsConfirmation) setNotice('Check your email to confirm your account, then sign in.');
      }
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-100 to-brand-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{TITLES[mode]}</h1>
            <p className="text-sm text-slate-500">
              {mode === 'reset'
                ? 'Enter your email and we will send you a reset link.'
                : 'AI-powered product management and delivery.'}
            </p>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {mode === 'signup' ? (
            <Field label="Your name">
              {(id) => (
                <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} />
              )}
            </Field>
          ) : null}
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
          {mode !== 'reset' ? (
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
          ) : null}
          {mode === 'signin' ? (
            <button
              type="button"
              className="text-xs font-medium text-brand-700 hover:underline"
              onClick={() => switchTo('reset')}
            >
              Forgot your password?
            </button>
          ) : null}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {SUBMIT[mode]}
          </Button>
          <p className="text-center text-xs text-slate-500">
            {mode === 'signin' ? 'New to ProductFlow AI?' : mode === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
            <button
              type="button"
              className="font-medium text-brand-700 hover:underline"
              onClick={() => switchTo(mode === 'signin' ? 'signup' : 'signin')}
            >
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
