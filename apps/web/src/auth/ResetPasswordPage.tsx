import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Logo } from '../app/Logo';
import { Alert, Button, Field, Input, Spinner } from '../components/ui';
import { backend } from '../lib/backend';
import { errorMessage } from '../lib/errors';
import { useAuth } from './AuthProvider';

/**
 * Opened from the password-reset email. Supabase signs the visitor in from
 * the link, so a session here means the link was valid.
 */
export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.auth.updatePassword(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-100 to-brand-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Choose a new password</h1>
          {loading ? (
            <Spinner />
          ) : !session ? (
            <>
              <Alert tone="error">This reset link is invalid or has expired. Request a new one from the sign-in page.</Alert>
              <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-slate-500">Signed in as {session.email}.</p>
              {error ? <Alert tone="error">{error}</Alert> : null}
              <Field label="New password" hint="At least 8 characters.">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Confirm new password">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" className="w-full" loading={busy}>
                Save new password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
