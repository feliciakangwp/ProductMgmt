import { PROJECT_ROLE_LABELS } from '@productflow/domain';
import { FolderKanban, Plus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Spinner, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useCreateProject, useProjects } from './api';

export function suggestProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let key = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  key = key.replace(/^[0-9]+/, '').slice(0, 10);
  return key.length >= 2
    ? key
    : words
        .join('')
        .replace(/^[0-9]+/, '')
        .slice(0, 4) || '';
}

export function ProjectsPage() {
  const projects = useProjects();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500">Each project has its own processes, requirements and team.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New project
        </Button>
      </div>

      {projects.isPending ? <Spinner /> : null}
      {projects.error ? (
        <Alert tone="error" title="Could not load projects">
          {errorMessage(projects.error)}
        </Alert>
      ) : null}
      {projects.data && projects.data.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-8" />}
          title="No projects yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first project
            </Button>
          }
        >
          Create a project to start describing business processes. You will be its administrator and can invite your team.
        </EmptyState>
      ) : null}

      {projects.data && projects.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.data.map((project) => (
            <li key={project.id} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-brand-700">{project.key}</p>
                  <h2 className="truncate text-base font-semibold text-slate-900">{project.name}</h2>
                </div>
                <Badge tone="blue">{PROJECT_ROLE_LABELS[project.role]}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-10 text-sm text-slate-500">{project.description || 'No description.'}</p>
              <div className="mt-4 flex gap-2">
                <Link
                  to={`/projects/${project.id}/processes`}
                  className="inline-flex h-8 items-center rounded-md bg-brand-700 px-3 text-xs font-medium text-white hover:bg-brand-800"
                >
                  Open processes
                </Link>
                <Link
                  to={`/projects/${project.id}/members`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Users className="size-3.5" /> Members
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const effectiveKey = keyTouched ? key : suggestProjectKey(name);
  const keyValid = /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey);

  function close() {
    setName('');
    setKey('');
    setKeyTouched(false);
    setDescription('');
    create.reset();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const project = await create
      .mutateAsync({ key: effectiveKey, name: name.trim(), description: description.trim() })
      .catch(() => null);
    if (project) {
      close();
      navigate(`/projects/${project.id}/processes`);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New project"
      description="You will become the project administrator."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="create-project"
            loading={create.isPending}
            disabled={!name.trim() || !keyValid}
          >
            Create project
          </Button>
        </>
      }
    >
      <form id="create-project" onSubmit={submit} className="space-y-4">
        {create.error ? <Alert tone="error">{errorMessage(create.error)}</Alert> : null}
        <Field label="Project name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              placeholder="Debt Management Modernisation"
            />
          )}
        </Field>
        <Field
          label="Project key"
          hint="2–10 letters or digits, starting with a letter. Used in identifiers such as DMM-PRC-001."
          error={effectiveKey && !keyValid ? 'Use 2–10 capital letters or digits, starting with a letter.' : null}
        >
          {(id) => (
            <Input
              id={id}
              value={effectiveKey}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 10),
                );
              }}
              className="font-mono uppercase"
              required
            />
          )}
        </Field>
        <Field label="Description (optional)">
          {(id) => (
            <Textarea id={id} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
