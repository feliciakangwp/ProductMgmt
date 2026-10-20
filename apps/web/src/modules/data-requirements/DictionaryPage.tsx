import {
  can,
  DATA_TYPE_LABELS,
  DATA_TYPES,
  FIELD_SOURCE_LABELS,
  FIELD_SOURCES,
  normaliseName,
  validateDictionary,
  type DataType,
  type FieldSource,
  type FieldStatus,
} from '@productflow/domain';
import { BookOpen, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, Dialog, EmptyState, Field, IconButton, Input, Select, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useProject } from '../projects/api';
import {
  useColumnMappings,
  useCreateFields,
  useDeletePhysicalColumn,
  useFieldUsages,
  useFields,
  usePhysicalColumns,
  useValidationRules,
} from './api';
import { DataModuleLayout } from './DataModuleLayout';
import { FieldDialog, FieldStatusBadge } from './FieldDialog';

/** The project's data dictionary: logical business fields, their rules, columns and usage. */
export function DictionaryPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const fields = useFields(projectId);
  const rules = useValidationRules(projectId);
  const usages = useFieldUsages(projectId);
  const mappings = useColumnMappings(projectId);
  const canEdit = can(project.data?.role, 'editData');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<FieldStatus | 'all'>('all');
  const [openField, setOpenField] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = normaliseName(query);
    return (fields.data ?? []).filter(
      (f) =>
        (status === 'all' || f.status === status) &&
        (!q || normaliseName(`${f.refCode} ${f.name} ${f.description} ${f.sourceDetail}`).includes(q)),
    );
  }, [fields.data, query, status]);
  const duplicates = useMemo(() => validateDictionary(fields.data ?? []), [fields.data]);
  const usageCount = (id: string) =>
    new Set((usages.data ?? []).filter((u) => u.fieldId === id).map((u) => `${u.processId}:${u.nodeKey}`)).size;

  return (
    <DataModuleLayout
      title="Data dictionary"
      description="Reusable business fields. Each field is defined once and used by any number of activities."
      actions={
        canEdit ? (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New field
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
          <Input
            aria-label="Search fields"
            placeholder="Search by name, ID or description"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as FieldStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Confirmed</option>
          <option value="deprecated">Deprecated</option>
        </Select>
      </div>
      {duplicates.map((d) => (
        <Alert key={d.id} tone="warning" className="mb-3">
          {d.message}
        </Alert>
      ))}
      {fields.isPending ? <Spinner /> : null}
      {fields.error ? <Alert tone="error">{errorMessage(fields.error)}</Alert> : null}
      {fields.data && fields.data.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-8" />} title="The dictionary is empty">
          Add fields here, or let AI suggest them from a process in the Activities view.
        </EmptyState>
      ) : null}
      {fields.data && fields.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5">ID</th>
                <th className="px-4 py-2.5">Field</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5 text-right">Rules</th>
                <th className="px-4 py-2.5 text-right">Columns</th>
                <th className="px-4 py-2.5 text-right">Used by</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((f) => (
                <tr key={f.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenField(f.id)}>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{f.refCode}</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      className="font-medium text-brand-700 hover:underline"
                      onClick={() => setOpenField(f.id)}
                    >
                      {f.name}
                    </button>
                    {f.origin === 'inferred' ? (
                      <Sparkles className="ml-1 inline size-3 text-violet-500" aria-label="Suggested by AI" />
                    ) : null}
                    {f.description ? (
                      <span className="block max-w-md truncate text-xs text-slate-500">{f.description}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{DATA_TYPE_LABELS[f.dataType]}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {FIELD_SOURCE_LABELS[f.source]}
                    {f.sourceDetail ? <span className="block text-slate-400">{f.sourceDetail}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {(rules.data ?? []).filter((r) => r.fieldId === f.id).length}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {(mappings.data ?? []).filter((m) => m.fieldId === f.id).length}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usageCount(f.id)}</td>
                  <td className="px-4 py-2.5">
                    <FieldStatusBadge status={f.status} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500">
                    No fields match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      <ColumnsList projectId={projectId} canEdit={canEdit} />

      <FieldDialog projectId={projectId} fieldId={openField} readOnly={!canEdit} onClose={() => setOpenField(null)} />
      <NewFieldDialog
        open={creating}
        projectId={projectId}
        onClose={(id) => {
          setCreating(false);
          if (id) setOpenField(id);
        }}
      />
    </DataModuleLayout>
  );
}

function NewFieldDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: (createdId?: string) => void;
}) {
  const create = useCreateFields(projectId);
  const empty = {
    name: '',
    description: '',
    dataType: 'string' as DataType,
    source: 'user_entered' as FieldSource,
    sourceDetail: '',
  };
  const [value, setValue] = useState(empty);

  function close(id?: string) {
    setValue(empty);
    create.reset();
    onClose(id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const created = await create
      .mutateAsync([{ ...value, allowedValues: [], defaultValue: '', origin: 'manual', status: 'approved' }])
      .catch(() => null);
    if (created?.[0]) close(created[0].id);
  }

  return (
    <Dialog
      open={open}
      onClose={() => close()}
      title="New field"
      description="Add a business field to the dictionary. You can add validation rules and columns next."
      footer={
        <>
          <Button onClick={() => close()}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-field" loading={create.isPending} disabled={!value.name.trim()}>
            Create field
          </Button>
        </>
      }
    >
      <form id="new-field" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {create.error ? (
          <Alert tone="error" className="sm:col-span-2">
            {errorMessage(create.error)}
          </Alert>
        ) : null}
        <Field label="Name" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={value.name}
              maxLength={200}
              required
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Data type">
          {(id) => (
            <Select id={id} value={value.dataType} onChange={(e) => setValue({ ...value, dataType: e.target.value as DataType })}>
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DATA_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Source">
          {(id) => (
            <Select id={id} value={value.source} onChange={(e) => setValue({ ...value, source: e.target.value as FieldSource })}>
              {FIELD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {FIELD_SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={value.description}
              maxLength={4000}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** The physical data model the dictionary maps onto. */
function ColumnsList({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const columns = usePhysicalColumns(projectId);
  const mappings = useColumnMappings(projectId);
  const fields = useFields(projectId);
  const remove = useDeletePhysicalColumn(projectId);
  if (!columns.data || columns.data.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-slate-900">Physical columns</h2>
      <p className="mb-2 text-xs text-slate-500">
        Database columns that business fields are mapped to. Map a column from a field's details.
      </p>
      {remove.error ? (
        <Alert tone="error" className="mb-2">
          {errorMessage(remove.error)}
        </Alert>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th className="px-4 py-2">System</th>
              <th className="px-4 py-2">Column</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Business fields</th>
              <th className="w-10 px-4 py-2">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {columns.data.map((c) => {
              const mapped = (mappings.data ?? [])
                .filter((m) => m.columnId === c.id)
                .map((m) => fields.data?.find((f) => f.id === m.fieldId))
                .filter(Boolean);
              return (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-600">{c.systemName}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {c.tableName}.{c.columnName}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{c.dataType}</td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {mapped.map((f) => `${f!.refCode} ${f!.name}`).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2">
                    {canEdit ? (
                      <IconButton
                        label={`Delete column ${c.columnName}`}
                        icon={<Trash2 className="size-3.5" />}
                        onClick={() => remove.mutate(c.id)}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
