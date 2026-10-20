import { PROJECT_ROLE_LABELS, PROJECT_ROLES, can, type ProjectRole } from '@productflow/domain';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Badge, Button, Field, IconButton, Input, Select, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useAddMember, useMembers, useProject, useRemoveMember, useUpdateMemberRole } from './api';

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  admin: 'Manages the project and its members.',
  product_owner: 'Approves process versions and prioritises work.',
  business_analyst: 'Describes processes, runs AI analysis and edits process maps.',
  developer: 'Reviews requirements (read-only in Phase 1).',
  business_user: 'Views requirements (read-only in Phase 1).',
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
    <div className="mx-auto max-w-4xl p-8">
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
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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
    </div>
  );
}
