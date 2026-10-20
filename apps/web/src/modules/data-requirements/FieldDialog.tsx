import {
  BUSINESS_RULE_CATEGORY_LABELS,
  DATA_TYPE_LABELS,
  DATA_TYPES,
  FIELD_SOURCE_LABELS,
  findDuplicateBusinessRule,
  FIELD_SOURCES,
  RULE_TYPE_LABELS,
  type DataType,
  type FieldDefinition,
  type FieldSource,
  type FieldStatus,
  type RuleTranslationProposal,
  type ValidationRule,
} from '@productflow/domain';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Dialog, Field, IconButton, Input, Select, Textarea } from '../../components/ui';
import { backend } from '../../lib/backend';
import { errorMessage, isConflict } from '../../lib/errors';
import {
  dataKeys,
  useAddColumnMapping,
  useBusinessRules,
  useColumnMappings,
  useCreateBusinessRule,
  useCreatePhysicalColumn,
  useCreateValidationRule,
  useDeleteField,
  useDeleteValidationRule,
  useFieldUsages,
  useFields,
  usePhysicalColumns,
  useRemoveColumnMapping,
  useUpdateField,
  useUpdateValidationRule,
  useValidationRules,
} from './api';
import { describeParams } from './format';
import { RuleForm } from './RuleForm';

const STATUS_TONE: Record<FieldStatus, 'amber' | 'green' | 'slate'> = { draft: 'amber', approved: 'green', deprecated: 'slate' };
const STATUS_LABEL: Record<FieldStatus, string> = { draft: 'Draft', approved: 'Confirmed', deprecated: 'Deprecated' };

export function FieldStatusBadge({ status }: { status: FieldStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** Everything about one dictionary field: details, validation rules, physical columns and where it is used. */
export function FieldDialog({
  projectId,
  fieldId,
  readOnly,
  onClose,
}: {
  projectId: string;
  fieldId: string | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const fields = useFields(projectId);
  const field = fields.data?.find((f) => f.id === fieldId);
  if (!fieldId) return null;
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={field ? `${field.refCode} ${field.name}` : 'Field'}
      description="Field definitions are shared by every activity that uses the field."
    >
      {field ? (
        <div className="space-y-6">
          <DetailsSection key={`${field.id}:${field.revision}`} projectId={projectId} field={field} readOnly={readOnly} />
          <RulesSection projectId={projectId} field={field} fields={fields.data ?? []} readOnly={readOnly} />
          <ColumnsSection projectId={projectId} field={field} readOnly={readOnly} />
          <UsageSection projectId={projectId} field={field} readOnly={readOnly} onClose={onClose} />
        </div>
      ) : (
        <p className="text-sm text-slate-500">This field no longer exists.</p>
      )}
    </Dialog>
  );
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-1.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailsSection({ projectId, field, readOnly }: { projectId: string; field: FieldDefinition; readOnly: boolean }) {
  const update = useUpdateField(projectId);
  const qc = useQueryClient();
  const [value, setValue] = useState(field);
  const [values, setValues] = useState(field.allowedValues.join('\n'));
  const changed = JSON.stringify({ ...value, allowedValues: parseValues(values) }) !== JSON.stringify(field);

  return (
    <Section
      title="Details"
      action={<FieldStatusBadge status={field.status} />}
      hint={
        field.origin === 'inferred' && field.status === 'draft'
          ? 'Suggested by AI. Check the details, then confirm the field.'
          : undefined
      }
    >
      {update.error ? (
        <Alert
          tone="error"
          action={
            isConflict(update.error) ? (
              <Button size="sm" onClick={() => void qc.invalidateQueries({ queryKey: dataKeys.fields(projectId) })}>
                Reload
              </Button>
            ) : undefined
          }
        >
          {errorMessage(update.error)}
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={value.name}
              maxLength={200}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Data type">
          {(id) => (
            <Select
              id={id}
              value={value.dataType}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, dataType: e.target.value as DataType })}
            >
              {DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DATA_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={value.description}
              maxLength={4000}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          )}
        </Field>
        {value.dataType === 'enum' ? (
          <Field label="Allowed values" hint="One value per line." className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={3} value={values} disabled={readOnly} onChange={(e) => setValues(e.target.value)} />}
          </Field>
        ) : null}
        <Field label="Source">
          {(id) => (
            <Select
              id={id}
              value={value.source}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, source: e.target.value as FieldSource })}
            >
              {FIELD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {FIELD_SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={
            value.source === 'retrieved'
              ? 'Retrieved from'
              : value.source === 'system_generated'
                ? 'Generated how'
                : 'Source detail'
          }
        >
          {(id) => (
            <Input
              id={id}
              value={value.sourceDetail}
              maxLength={500}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, sourceDetail: e.target.value })}
            />
          )}
        </Field>
        <Field label="Default value">
          {(id) => (
            <Input
              id={id}
              value={value.defaultValue}
              maxLength={500}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, defaultValue: e.target.value })}
            />
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={value.status}
              disabled={readOnly}
              onChange={(e) => setValue({ ...value, status: e.target.value as FieldStatus })}
            >
              <option value="draft">Draft</option>
              <option value="approved">Confirmed</option>
              <option value="deprecated">Deprecated</option>
            </Select>
          )}
        </Field>
      </div>
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          {field.status === 'draft' && !changed ? (
            <Button
              size="sm"
              icon={<Check className="size-3.5 text-emerald-600" />}
              loading={update.isPending}
              onClick={() => update.mutate({ ...field, status: 'approved' })}
            >
              Confirm field
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            disabled={!changed || !value.name.trim()}
            loading={update.isPending}
            onClick={() => update.mutate({ ...value, allowedValues: parseValues(values) })}
          >
            Save details
          </Button>
        </div>
      )}
    </Section>
  );
}

const parseValues = (text: string) =>
  text
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);

function RulesSection({
  projectId,
  field,
  fields,
  readOnly,
}: {
  projectId: string;
  field: FieldDefinition;
  fields: FieldDefinition[];
  readOnly: boolean;
}) {
  const rules = useValidationRules(projectId);
  const businessRules = useBusinessRules(projectId);
  const create = useCreateValidationRule(projectId);
  const update = useUpdateValidationRule(projectId);
  const remove = useDeleteValidationRule(projectId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const own = (rules.data ?? []).filter((r) => r.fieldId === field.id);
  const error = create.error ?? update.error ?? remove.error;

  return (
    <Section title="Validation rules" hint="Rules checked whenever this field is captured.">
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {own.length === 0 ? <p className="text-xs text-slate-500">No validation rules yet.</p> : null}
      <ul className="space-y-2">
        {own.map((rule) =>
          editing === rule.id ? (
            <li key={rule.id}>
              <RuleForm
                field={field}
                fields={fields}
                businessRules={businessRules.data ?? []}
                initial={{
                  ruleType: rule.ruleType,
                  params: rule.params,
                  statement: rule.statement,
                  errorMessage: rule.errorMessage,
                  businessRuleId: rule.businessRuleId,
                }}
                submitLabel="Save rule"
                busy={update.isPending}
                onCancel={() => setEditing(null)}
                onSubmit={(v) => update.mutate({ ...rule, ...v }, { onSuccess: () => setEditing(null) })}
              />
            </li>
          ) : (
            <RuleItem
              key={rule.id}
              rule={rule}
              fields={fields}
              businessRef={businessRules.data?.find((b) => b.id === rule.businessRuleId)?.refCode}
              readOnly={readOnly}
              onConfirm={() => update.mutate({ ...rule, status: 'confirmed' })}
              onEdit={() => setEditing(rule.id)}
              onDelete={() => remove.mutate(rule.id)}
            />
          ),
        )}
      </ul>
      {readOnly ? null : adding ? (
        <RuleForm
          field={field}
          fields={fields}
          businessRules={businessRules.data ?? []}
          submitLabel="Add rule"
          busy={create.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={(v) =>
            create.mutate(
              { ...v, fieldId: field.id, sourceText: null, origin: 'manual', status: 'confirmed' },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add rule
          </Button>
        </div>
      )}
      {readOnly ? null : <TranslatePanel projectId={projectId} field={field} />}
    </Section>
  );
}

function RuleItem({
  rule,
  fields,
  businessRef,
  readOnly,
  onConfirm,
  onEdit,
  onDelete,
}: {
  rule: ValidationRule;
  fields: FieldDefinition[];
  businessRef: string | undefined;
  readOnly: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const params = describeParams(rule, fields);
  return (
    <li className="rounded-md border border-slate-200 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-slate-400">{rule.refCode}</span>
        <Badge tone="blue">{RULE_TYPE_LABELS[rule.ruleType]}</Badge>
        {params ? <Badge>{params}</Badge> : null}
        {rule.status === 'draft' ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Confirmed</Badge>}
        {rule.origin === 'inferred' ? (
          <Badge tone="violet">
            <Sparkles className="size-3" /> AI
          </Badge>
        ) : null}
        {businessRef ? <Badge title="Enforces this business rule">{businessRef}</Badge> : null}
        {readOnly ? null : (
          <span className="ml-auto flex gap-0.5">
            {rule.status === 'draft' ? (
              <Button size="sm" variant="secondary" icon={<Check className="size-3.5 text-emerald-600" />} onClick={onConfirm}>
                Confirm
              </Button>
            ) : null}
            <IconButton label={`Edit ${rule.refCode}`} icon={<Pencil className="size-3.5" />} onClick={onEdit} />
            <IconButton label={`Delete ${rule.refCode}`} icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
          </span>
        )}
      </div>
      <p className="mt-1 text-slate-800">{rule.statement}</p>
      {rule.errorMessage ? <p className="text-xs text-slate-500">Message: “{rule.errorMessage}”</p> : null}
      {rule.sourceText ? <p className="text-xs text-slate-400 italic">From: “{rule.sourceText}”</p> : null}
    </li>
  );
}

/** Natural language in, structured draft rules out; the analyst picks what to keep. */
function TranslatePanel({ projectId, field }: { projectId: string; field: FieldDefinition }) {
  const createRule = useCreateValidationRule(projectId);
  const createBusinessRule = useCreateBusinessRule(projectId);
  const register = useBusinessRules(projectId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<RuleTranslationProposal | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const duplicateOf = (b: { title: string; statement: string }) => findDuplicateBusinessRule(b, register.data ?? []);

  useEffect(() => {
    // Business rules already in the register are not proposed again by default.
    if (proposal) {
      setPicked(
        new Set([
          ...proposal.rules.map((r) => r.key),
          ...proposal.businessRules.filter((b) => !duplicateOf(b)).map((b) => b.key),
        ]),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  async function translate() {
    setBusy(true);
    setError(null);
    try {
      setProposal((await backend.translateValidationRule({ fieldId: field.id, text })).proposal);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addPicked() {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      for (const r of proposal.rules.filter((x) => picked.has(x.key))) {
        await createRule.mutateAsync({
          fieldId: field.id,
          ruleType: r.ruleType,
          params: r.params,
          statement: r.statement,
          errorMessage: r.errorMessage,
          sourceText: text.trim(),
          origin: 'inferred',
          status: 'draft',
          businessRuleId: null,
        });
      }
      for (const b of proposal.businessRules.filter((x) => picked.has(x.key))) {
        await createBusinessRule.mutateAsync({
          title: b.title,
          statement: b.statement,
          category: b.category,
          origin: 'inferred',
          activities: [],
        });
      }
      setProposal(null);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };

  return (
    <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/50 p-3">
      <Field
        label="Describe the validation logic in plain language"
        hint="Claude turns it into structured rules for you to review. They are added as drafts."
      >
        {(id) => (
          <Textarea
            id={id}
            rows={2}
            value={text}
            maxLength={4000}
            placeholder="Outstanding amount must be greater than zero. If the amount exceeds $10,000, Director approval is required."
            onChange={(e) => setText(e.target.value)}
          />
        )}
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {proposal ? (
        <div className="space-y-2 text-sm">
          {proposal.rules.length === 0 && proposal.businessRules.length === 0 ? (
            <p className="text-slate-500">No rules found in the text.</p>
          ) : null}
          {proposal.rules.map((r) => (
            <label key={r.key} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2">
              <input type="checkbox" className="mt-1" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
              <span>
                <Badge tone="blue">{RULE_TYPE_LABELS[r.ruleType]}</Badge>{' '}
                {describeParams(r) ? <Badge>{describeParams(r)}</Badge> : null}
                <span className="block text-slate-800">{r.statement}</span>
                {r.errorMessage ? <span className="block text-xs text-slate-500">Message: “{r.errorMessage}”</span> : null}
              </span>
            </label>
          ))}
          {proposal.businessRules.map((b) => {
            const duplicate = duplicateOf(b);
            return (
              <label key={b.key} className="flex items-start gap-2 rounded-md border border-amber-200 bg-white p-2">
                <input type="checkbox" className="mt-1" checked={picked.has(b.key)} onChange={() => toggle(b.key)} />
                <span>
                  <Badge tone="amber">Business rule · {BUSINESS_RULE_CATEGORY_LABELS[b.category]}</Badge>
                  {duplicate ? (
                    <Badge tone="green" className="ml-1" title="Adding it again would duplicate the register entry">
                      Already in register as {duplicate.refCode}
                    </Badge>
                  ) : null}
                  <span className="block font-medium text-slate-800">{b.title}</span>
                  <span className="block text-xs text-slate-600">{b.statement}</span>
                </span>
              </label>
            );
          })}
          {proposal.questions.length > 0 ? (
            <Alert tone="warning" title="Questions">
              <ul className="list-disc pl-4">
                {proposal.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={picked.size === 0} loading={busy} onClick={() => void addPicked()}>
              Add {picked.size} as drafts
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            size="sm"
            icon={<Sparkles className="size-3.5 text-violet-600" />}
            loading={busy}
            disabled={text.trim().length < 5}
            onClick={() => void translate()}
          >
            {busy ? 'Translating…' : 'Translate with AI'}
          </Button>
        </div>
      )}
    </div>
  );
}

function ColumnsSection({ projectId, field, readOnly }: { projectId: string; field: FieldDefinition; readOnly: boolean }) {
  const columns = usePhysicalColumns(projectId);
  const mappings = useColumnMappings(projectId);
  const add = useAddColumnMapping(projectId);
  const remove = useRemoveColumnMapping(projectId);
  const createColumn = useCreatePhysicalColumn(projectId);
  const [columnId, setColumnId] = useState('');
  const [transformation, setTransformation] = useState('');
  const [newColumn, setNewColumn] = useState<{
    systemName: string;
    tableName: string;
    columnName: string;
    dataType: string;
  } | null>(null);
  const own = (mappings.data ?? []).filter((m) => m.fieldId === field.id);
  const columnById = new Map((columns.data ?? []).map((c) => [c.id, c]));
  const error = add.error ?? remove.error ?? createColumn.error;

  return (
    <Section title="Physical columns" hint="Where the value is stored. A business field can map to several columns, or none.">
      {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
      {own.length === 0 ? <p className="text-xs text-slate-500">Not mapped to any column.</p> : null}
      <ul className="space-y-1 text-sm">
        {own.map((m) => {
          const c = columnById.get(m.columnId);
          return (
            <li key={m.columnId} className="flex items-center gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {c ? `${c.systemName} · ${c.tableName}.${c.columnName}` : 'Unknown column'}
              </code>
              {c?.dataType ? <span className="text-xs text-slate-500">{c.dataType}</span> : null}
              {m.transformation ? <span className="text-xs text-slate-600">{m.transformation}</span> : null}
              {readOnly ? null : (
                <IconButton
                  className="ml-auto"
                  label="Remove mapping"
                  icon={<Trash2 className="size-3.5" />}
                  onClick={() => remove.mutate({ fieldId: field.id, columnId: m.columnId })}
                />
              )}
            </li>
          );
        })}
      </ul>
      {readOnly ? null : newColumn ? (
        <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 sm:grid-cols-4">
          <Input
            aria-label="System"
            placeholder="System"
            className="h-8"
            value={newColumn.systemName}
            onChange={(e) => setNewColumn({ ...newColumn, systemName: e.target.value })}
          />
          <Input
            aria-label="Table"
            placeholder="Table"
            className="h-8"
            value={newColumn.tableName}
            onChange={(e) => setNewColumn({ ...newColumn, tableName: e.target.value })}
          />
          <Input
            aria-label="Column"
            placeholder="Column"
            className="h-8"
            value={newColumn.columnName}
            onChange={(e) => setNewColumn({ ...newColumn, columnName: e.target.value })}
          />
          <Input
            aria-label="Column type"
            placeholder="Type"
            className="h-8"
            value={newColumn.dataType}
            onChange={(e) => setNewColumn({ ...newColumn, dataType: e.target.value })}
          />
          <div className="flex justify-end gap-2 sm:col-span-4">
            <Button size="sm" variant="ghost" onClick={() => setNewColumn(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={createColumn.isPending}
              disabled={!newColumn.systemName.trim() || !newColumn.tableName.trim() || !newColumn.columnName.trim()}
              onClick={() =>
                createColumn.mutate(
                  { ...newColumn, notes: '' },
                  {
                    onSuccess: (c) => {
                      setNewColumn(null);
                      setColumnId(c.id);
                    },
                  },
                )
              }
            >
              Create column
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Column to map"
            className="h-8 w-auto min-w-56"
            value={columnId}
            onChange={(e) => setColumnId(e.target.value)}
          >
            <option value="">Choose a column…</option>
            {(columns.data ?? [])
              .filter((c) => !own.some((m) => m.columnId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.systemName} · {c.tableName}.{c.columnName}
                </option>
              ))}
          </Select>
          <Input
            aria-label="Transformation"
            placeholder="Transformation (optional)"
            className="h-8 w-56"
            value={transformation}
            onChange={(e) => setTransformation(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!columnId}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { fieldId: field.id, columnId, transformation },
                {
                  onSuccess: () => {
                    setColumnId('');
                    setTransformation('');
                  },
                },
              )
            }
          >
            Map column
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() => setNewColumn({ systemName: '', tableName: '', columnName: '', dataType: '' })}
          >
            New column
          </Button>
        </div>
      )}
    </Section>
  );
}

function UsageSection({
  projectId,
  field,
  readOnly,
  onClose,
}: {
  projectId: string;
  field: FieldDefinition;
  readOnly: boolean;
  onClose: () => void;
}) {
  const usages = useFieldUsages(projectId);
  const remove = useDeleteField(projectId);
  const own = (usages.data ?? [])
    .filter((u) => u.fieldId === field.id)
    .sort((a, b) => a.processRef.localeCompare(b.processRef) || b.versionNumber - a.versionNumber);
  return (
    <Section title="Used by" hint="Activities that read or produce this field, in every process version.">
      {own.length === 0 ? <p className="text-xs text-slate-500">Not used by any activity.</p> : null}
      <ul className="space-y-1 text-sm">
        {own.map((u) => (
          <li key={`${u.versionId}:${u.nodeKey}:${u.direction}`} className="flex flex-wrap items-center gap-2">
            <Badge tone={u.direction === 'input' ? 'blue' : 'green'}>{u.direction === 'input' ? 'Input' : 'Output'}</Badge>
            <Link
              to={`/projects/${projectId}/data/processes/${u.processId}?version=${u.versionId}&activity=${u.nodeKey}`}
              onClick={onClose}
              className="text-brand-700 hover:underline"
            >
              {u.processRef} {u.processName} · v{u.versionNumber}
            </Link>
            <span className="text-slate-600">
              {u.nodeRef ? <span className="font-mono text-xs text-slate-400">{u.nodeRef} </span> : null}
              {u.nodeLabel}
            </span>
            <Badge tone={u.versionStatus === 'draft' ? 'amber' : u.versionStatus === 'approved' ? 'green' : 'slate'}>
              {u.versionStatus}
            </Badge>
          </li>
        ))}
      </ul>
      {readOnly || own.length > 0 ? null : (
        <div className="flex items-center justify-end gap-2">
          {remove.error ? <span className="text-xs text-red-700">{errorMessage(remove.error)}</span> : null}
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            loading={remove.isPending}
            onClick={() => remove.mutate(field.id, { onSuccess: onClose })}
          >
            Delete field
          </Button>
        </div>
      )}
    </Section>
  );
}
