import { DELIVERY_ROLES, PERMISSIONS, PROJECT_ROLE_LABELS, PROJECT_ROLES, can, type ProjectRole } from '@productflow/domain';
import { ArrowLeft, Check, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Badge, Button, Field, IconButton, Input, Select, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useAddMember, useMembers, useProject, useRemoveMember, useUpdateMemberRole } from './api';

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  admin: 'Manages the project, its members and settings; can do everything below.',
  product_owner: 'Approves processes, rules, stories and scenarios; prioritises the backlog and plans sprints.',
  business_analyst: 'Describes processes, defines data, writes stories and test scenarios, runs AI analysis.',
  developer: 'Writes and confirms technical stories, estimates, works the Kanban board and fixes defects.',
  business_user: 'Runs UAT, raises defects and verifies fixes.',
};

export function MembersPage() {
  const { projectId = '' } = useParams();
  const { session } = useAuth();
  const project = useProject(projectId);
  const members = useMembers(projectId);
  const add = useAddMember(projectId);
  const updateRole = useUpdateMemberRole(projectId);
  const remove = useRemoveMember(projectId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('business_analyst');
  const isAdmin = can(project.data?.role, 'manageMembers');
  const mutationError = add.error ?? updateRole.error ?? remove.error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await add.mutateAsync({ email: email.trim(), role }).then(
      () => true,
      () => false,
    );
    if (ok) setEmail('');
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-8">
      <Link to="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">{project.data ? `${project.data.name} · Members` : 'Members'}</h1>
      <p className="mb-6 text-sm text-slate-500">
        Access to every record in this project is controlled by these roles, enforced by the database.
      </p>

      {mutationError ? (
        <Alert tone="error" className="mb-4">
          {errorMessage(mutationError)}
        </Alert>
      ) : null}

      {isAdmin ? (
        <form
          onSubmit={submit}
          className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        >
          <Field label="Email of a registered user" className="min-w-64 flex-1">
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="colleague@example.com"
              />
            )}
          </Field>
          <Field label="Role" className="w-52">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
                {PROJECT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {PROJECT_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="primary" icon={<UserPlus className="size-4" />} loading={add.isPending}>
            Add member
          </Button>
          <p className="w-full text-xs text-slate-500">The person must have created a ProductFlow AI account first.</p>
        </form>
      ) : (
        <Alert className="mb-6">Only project administrators can add or change members.</Alert>
      )}

      {members.isPending ? <Spinner /> : null}
      {members.error ? <Alert tone="error">{errorMessage(members.error)}</Alert> : null}
      {members.data ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="w-12 px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.data.map((m) => (
                <tr key={m.userId}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {m.displayName} {m.userId === session?.userId ? <Badge className="ml-1">You</Badge> : null}
                    </p>
                    <p className="text-xs text-slate-500">{m.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <Select
                        aria-label={`Role for ${m.displayName}`}
                        className="h-8 w-52"
                        value={m.role}
                        disabled={updateRole.isPending}
                        onChange={(e) => updateRole.mutate({ userId: m.userId, role: e.target.value as ProjectRole })}
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {PROJECT_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span>{PROJECT_ROLE_LABELS[m.role]}</span>
                    )}
                    <p className="mt-1 text-xs text-slate-500">{ROLE_DESCRIPTIONS[m.role]}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin ? (
                      <IconButton
                        label={`Remove ${m.displayName}`}
                        icon={<Trash2 className="size-4" />}
                        onClick={() => {
                          if (window.confirm(`Remove ${m.displayName} from this project?`)) remove.mutate({ userId: m.userId });
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <PermissionMatrix />
    </div>
  );
}

const MATRIX: { label: string; roles: readonly ProjectRole[] }[] = [
  { label: 'Manage members and settings', roles: PERMISSIONS.manageMembers },
  { label: 'Edit processes and run process analysis', roles: PERMISSIONS.editProcess },
  { label: 'Approve process versions and business rules', roles: PERMISSIONS.approveProcess },
  { label: 'Define data requirements', roles: PERMISSIONS.editData },
  { label: 'Write functional stories', roles: DELIVERY_ROLES.editFunctional },
  { label: 'Write and confirm technical stories', roles: DELIVERY_ROLES.editTechnical },
  { label: 'Approve stories, prioritise backlog, plan sprints', roles: DELIVERY_ROLES.manageBacklog },
  { label: 'Estimate, move Kanban cards, update effort', roles: DELIVERY_ROLES.updateWork },
  { label: 'Write test scenarios', roles: DELIVERY_ROLES.editScenarios },
  { label: 'Approve test scenarios', roles: DELIVERY_ROLES.approveScenario },
  { label: 'Run UAT, verify defect fixes', roles: DELIVERY_ROLES.executeTests },
  { label: 'Work on defects', roles: DELIVERY_ROLES.workDefect },
  { label: 'Run change impact and improvement analysis', roles: DELIVERY_ROLES.runInsights },
];

/** What each role may do. The server enforces the same rules on every request. */
function PermissionMatrix() {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Role permissions</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Permission</th>
              {PROJECT_ROLES.map((r) => (
                <th key={r} className="px-2 py-2 text-center">
                  {PROJECT_ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MATRIX.map((row) => (
              <tr key={row.label}>
                <td className="px-3 py-1.5 text-slate-700">{row.label}</td>
                {PROJECT_ROLES.map((r) => (
                  <td key={r} className="px-2 py-1.5 text-center">
                    {row.roles.includes(r) ? (
                      <Check className="mx-auto size-4 text-emerald-600" aria-label="Allowed" />
                    ) : (
                      <span className="text-slate-300" aria-label="Not allowed">
                        –
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Every member can read the project and comment. Testers who raised a defect can also edit its details.
      </p>
    </section>
  );
}
