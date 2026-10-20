import {
  DATA_TYPE_LABELS,
  DATA_TYPES,
  FIELD_SOURCE_LABELS,
  FIELD_SOURCES,
  normaliseName,
  type DataType,
  type FieldDefinition,
  type FieldSource,
} from '@productflow/domain';
import { Plus, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Alert, Button, Input, Select } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useCreateFields } from './api';

/**
 * Adds a dictionary field to an activity: search the dictionary, or create a
 * new (draft) field when nothing fits.
 */
export function FieldPicker({
  projectId,
  fields,
  exclude,
  label,
  onPick,
}: {
  projectId: string;
  fields: FieldDefinition[];
  /** Field ids already used here. */
  exclude: Set<string>;
  label: string;
  onPick: (field: FieldDefinition) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<{ name: string; dataType: DataType; source: FieldSource } | null>(null);
  const create = useCreateFields(projectId);

  const matches = useMemo(() => {
    const q = normaliseName(query);
    return fields
      .filter((f) => f.status !== 'deprecated' && !exclude.has(f.id))
      .filter((f) => !q || normaliseName(`${f.refCode} ${f.name} ${f.description}`).includes(q))
      .slice(0, 8);
  }, [fields, exclude, query]);
  const exact = fields.some((f) => normaliseName(f.name) === normaliseName(query));

  function reset() {
    setOpen(false);
    setQuery('');
    setCreating(null);
    create.reset();
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-600">New dictionary field (saved as a draft to confirm later)</p>
        {create.error ? <Alert tone="error">{errorMessage(create.error)}</Alert> : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            aria-label="New field name"
            value={creating.name}
            maxLength={200}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            className="h-8"
          />
          <Select
            aria-label="New field type"
            className="h-8"
            value={creating.dataType}
            onChange={(e) => setCreating({ ...creating, dataType: e.target.value as DataType })}
          >
            {DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {DATA_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="New field source"
            className="h-8"
            value={creating.source}
            onChange={(e) => setCreating({ ...creating, source: e.target.value as FieldSource })}
          >
            {FIELD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {FIELD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={reset}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!creating.name.trim()}
            loading={create.isPending}
            onClick={async () => {
              const [field] = await create
                .mutateAsync([
                  {
                    name: creating.name,
                    dataType: creating.dataType,
                    source: creating.source,
                    description: '',
                    allowedValues: [],
                    defaultValue: '',
                    sourceDetail: '',
                    origin: 'manual',
                  },
                ])
                .catch(() => []);
              if (field) {
                onPick(field);
                reset();
              }
            }}
          >
            Create and add
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-slate-400" />
        <Input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-label={label}
          placeholder="Search the data dictionary…"
          className="h-8 pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') reset();
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              onPick(matches[0]);
              reset();
            }
          }}
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        className="mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
      >
        {matches.map((f) => (
          <li key={f.id} role="option" aria-selected="false">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-50"
              onClick={() => {
                onPick(f);
                reset();
              }}
            >
              <span className="font-mono text-[11px] text-slate-400">{f.refCode}</span>
              <span className="flex-1 truncate text-slate-800">{f.name}</span>
              <span className="text-[11px] text-slate-500">{DATA_TYPE_LABELS[f.dataType]}</span>
            </button>
          </li>
        ))}
        {matches.length === 0 && !query ? (
          <li className="px-3 py-2 text-xs text-slate-500">The dictionary has no other fields yet.</li>
        ) : null}
        {query.trim() && !exact ? (
          <li role="option" aria-selected="false">
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
              onClick={() => setCreating({ name: query.trim(), dataType: 'string', source: 'user_entered' })}
            >
              <Plus className="size-3.5" /> Create field “{query.trim()}”
            </button>
          </li>
        ) : null}
        <li>
          <button type="button" className="w-full px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50" onClick={reset}>
            Cancel
          </button>
        </li>
      </ul>
    </div>
  );
}
