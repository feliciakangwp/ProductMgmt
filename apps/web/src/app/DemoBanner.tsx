import { PROJECT_ROLE_LABELS, PROJECT_ROLES, type ProjectRole } from '@productflow/domain';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, Select } from '../components/ui';
import type { DemoControls } from '../lib/backend';

/** Explains the demo and lets the viewer switch roles or start over. */
export function DemoBanner({ demo, projectId }: { demo: DemoControls; projectId: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);
  const role = projectId ? demo.myRole(projectId) : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-5 py-1.5 text-xs text-amber-900">
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Demo.</span> Your changes are kept in this browser only. Process analysis uses Claude on
        your claude.ai account.
        <span className="ml-1 md:hidden">Best viewed on a larger screen.</span>
      </p>
      {projectId && role ? (
        <label className="flex items-center gap-1.5">
          View as
          <Select
            aria-label="Demo role"
            className="h-7 w-44 bg-white text-xs"
            value={role}
            onChange={(e) => {
              demo.setMyRole(projectId, e.target.value as ProjectRole);
              void qc.invalidateQueries();
            }}
          >
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r}>
                {PROJECT_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="h-7"
        icon={<RotateCcw className="size-3.5" />}
        onClick={() => setConfirmReset(true)}
      >
        Reset demo
      </Button>
      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        size="sm"
        title="Reset the demo?"
        description="Everything you changed is discarded and the example project is restored."
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                demo.reset();
                setConfirmReset(false);
                qc.clear();
                navigate('/projects', { replace: true });
              }}
            >
              Reset demo
            </Button>
          </>
        }
      />
    </div>
  );
}
