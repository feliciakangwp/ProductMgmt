import type { ValidationIssue } from '@productflow/domain';
import { useState } from 'react';
import { Alert, Button, Dialog } from '../../components/ui';
import { errorMessage } from '../../lib/errors';

export function ApproveDialog({
  open,
  versionNumber,
  issues,
  onApprove,
  onClose,
}: {
  open: boolean;
  versionNumber: number;
  issues: ValidationIssue[];
  onApprove: () => Promise<void>;
  onClose: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const canApprove = errors.length === 0 && (warnings.length === 0 || acknowledged);

  function close() {
    setAcknowledged(false);
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : close}
      title={`Approve version ${versionNumber}`}
      description="An approved version is frozen. Later changes go into a new draft version, so approved requirements are never overwritten."
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canApprove}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onApprove();
                setAcknowledged(false);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve version
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {errors.length > 0 ? (
          <Alert tone="error" title={`${errors.length} error${errors.length > 1 ? 's' : ''} must be fixed first`}>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {errors.slice(0, 8).map((i) => (
                <li key={i.id}>{i.message}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {errors.length === 0 && warnings.length > 0 ? (
          <>
            <Alert tone="warning" title={`${warnings.length} warning${warnings.length > 1 ? 's' : ''} to review`}>
              <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-4">
                {warnings.map((i) => (
                  <li key={i.id}>{i.message}</li>
                ))}
              </ul>
            </Alert>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I have reviewed these warnings and want to approve this version anyway.
            </label>
          </>
        ) : null}
        {issues.length === 0 ? <Alert tone="success">No validation issues found.</Alert> : null}
      </div>
    </Dialog>
  );
}
