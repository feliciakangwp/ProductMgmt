import {
  BUSINESS_RULE_CATEGORIES,
  BUSINESS_RULE_CATEGORY_LABELS,
  can,
  dataActivities,
  type BusinessRule,
  type BusinessRuleCategory,
  type BusinessRuleStatus,
} from '@productflow/domain';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Plus, Scale, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui';
import { backend, type PromotableFinding } from '../../lib/backend';
import { errorMessage } from '../../lib/errors';
import { useProcesses, type ProcessSummary } from '../processes/api';
import { useProject } from '../projects/api';
import {
  useBusinessRules,
  useCreateBusinessRule,
  useDeleteBusinessRule,
  useFields,
  usePromotableFindings,
  usePromoteFinding,
  useUpdateBusinessRule,
  useValidationRules,
} from './api';
import { AiBadge } from './ActivityDataPanel';
import { DataModuleLayout } from './DataModuleLayout';

const STATUS_TONE: Record<BusinessRuleStatus, 'amber' | 'green' | 'slate'> = {
  draft: 'amber',
  approved: 'green',
  retired: 'slate',
};
const STATUS_LABEL: Record<BusinessRuleStatus, string> = { draft: 'Draft', approved: 'Approved', retired: 'Retired' };

/** The project's business rule register. Rules are maintained here once and linked to activities and validations. */
export function BusinessRulesPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const rules = useBusinessRules(projectId);
  const findings = usePromotableFindings(projectId);
  const processes = useProcesses(projectId);
  const canEdit = can(project.data?.role, 'editData');
  const canApprove = can(project.data?.role, 'approveBusinessRule');
  const [editing, setEditing] = useState<BusinessRule | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<BusinessRuleStatus | 'all'>('all');
  const toPromote = (findings.data ?? []).filter((f) => !f.promoted);
  const shown = (rules.data ?? []).filter((r) => status === 'all' || r.status === status);
  const processRef = (id: string) => processes.data?.find((p) => p.id === id)?.ref_code ?? '';

  return (
    <DataModuleLayout
      title="Business rules"
      description="One register of the rules the business enforces, linked to the activities they govern."
      actions={
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<ArrowUpRight className="size-4" />}
              onClick={() => setImporting(true)}
              disabled={toPromote.length === 0}
            >
              Import from processes{toPromote.length ? ` (${toPromote.length})` : ''}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New rule
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mb-4 flex items-center gap-2">
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as BusinessRuleStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="retired">Retired</option>
        </Select>
        {canEdit && toPromote.length > 0 ? (
          <p className="text-xs text-slate-500">
            {toPromote.length} business rule{toPromote.length > 1 ? 's' : ''} found in process descriptions{' '}
            {toPromote.length > 1 ? 'are' : 'is'} not in the register yet.
          </p>
        ) : null}
      </div>
      {rules.isPending ? <Spinner /> : null}
      {rules.error ? <Alert tone="error">{errorMessage(rules.error)}</Alert> : null}
      {rules.data && rules.data.length === 0 ? (
        <EmptyState icon={<Scale className="size-8" />} title="No business rules yet">
          Import the rules AI found in your process descriptions, or add one.
        </EmptyState>
      ) : null}
      {shown.length > 0 ? (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-brand-500"
                onClick={() => setEditing(r)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">{r.refCode}</span>
                  <span className="font-medium text-slate-900">{r.title}</span>
                  <Badge>{BUSINESS_RULE_CATEGORY_LABELS[r.category]}</Badge>
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {r.origin === 'inferred' ? <AiBadge /> : null}
                  {r.sourceFinding ? <Badge tone="blue">From process description</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-700">{r.statement}</p>
                {r.activities.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Applies to {r.activities.length} activit{r.activities.length > 1 ? 'ies' : 'y'} in{' '}
                    {[...new Set(r.activities.map((a) => processRef(a.processId)))].filter(Boolean).join(', ')}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <BusinessRuleDialog
          projectId={projectId}
          rule={editing === 'new' ? null : editing}
          processes={processes.data ?? []}
          canEdit={canEdit}
          canApprove={canApprove}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <ImportDialog projectId={projectId} findings={toPromote} onClose={() => setImporting(false)} /> : null}
    </DataModuleLayout>
  );
}

function BusinessRuleDialog({
  projectId,
  rule,
  processes,
  canEdit,
  canApprove,
  onClose,
}: {
  projectId: string;
  rule: BusinessRule | null;
  processes: ProcessSummary[];
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
}) {
  const create = useCreateBusinessRule(projectId);
  const update = useUpdateBusinessRule(projectId);
  const remove = useDeleteBusinessRule(projectId);
  const validations = useValidationRules(projectId);
  const fields = useFields(projectId);
  const [value, setValue] = useState(
    rule ?? {
      title: '',
      statement: '',
      category: 'other' as BusinessRuleCategory,
      status: 'draft' as BusinessRuleStatus,
      activities: [] as BusinessRule['activities'],
    },
  );
  const locked = rule?.status === 'approved';
  const editable = canEdit && !locked;
  const error = create.error ?? update.error ?? remove.error;
  const linkedValidations = rule ? (validations.data ?? []).filter((v) => v.businessRuleId === rule.id) : [];

  const saveWith = (status: BusinessRuleStatus) => {
    if (!rule) {
      create.mutate(
        {
          title: value.title,
          statement: value.statement,
          category: value.category,
          origin: 'manual',
          activities: value.activities,
        },
        { onSuccess: onClose },
      );
    } else {
      update.mutate({ ...rule, ...value, status }, { onSuccess: onClose });
    }
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={rule ? `${rule.refCode} ${rule.title}` : 'New business rule'}
      description={
        locked
          ? 'Approved rules are locked. Return the rule to draft to change its wording.'
          : 'Write the rule as one precise, testable statement.'
      }
      footer={
        <>
          {rule && canEdit && rule.status !== 'approved' ? (
            <Button
              variant="danger"
              className="mr-auto"
              icon={<Trash2 className="size-3.5" />}
              loading={remove.isPending}
              onClick={() => remove.mutate(rule.id, { onSuccess: onClose })}
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={onClose}>{canEdit || canApprove ? 'Cancel' : 'Close'}</Button>
          {rule && (canEdit || canApprove) && rule.status === 'approved' ? (
            <>
              <Button icon={<X className="size-3.5" />} loading={update.isPending} onClick={() => saveWith('retired')}>
                Retire
              </Button>
              <Button loading={update.isPending} onClick={() => saveWith('draft')}>
                Return to draft
              </Button>
            </>
          ) : null}
          {rule && canEdit && rule.status === 'retired' ? (
            <Button loading={update.isPending} onClick={() => saveWith('draft')}>
              Reinstate as draft
            </Button>
          ) : null}
          {rule && canApprove && rule.status === 'draft' ? (
            <Button
              icon={<Check className="size-3.5 text-emerald-600" />}
              loading={update.isPending}
              disabled={!value.title.trim() || !value.statement.trim()}
              onClick={() => saveWith('approved')}
            >
              Approve
            </Button>
          ) : null}
          {editable ? (
            <Button
              variant="primary"
              loading={create.isPending || update.isPending}
              disabled={!value.title.trim() || !value.statement.trim()}
              onClick={() => saveWith(rule?.status ?? 'draft')}
            >
              {rule ? 'Save' : 'Add rule'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={value.title}
                maxLength={200}
                disabled={!editable}
                onChange={(e) => setValue({ ...value, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <Select
                id={id}
                value={value.category}
                disabled={!editable}
                onChange={(e) => setValue({ ...value, category: e.target.value as BusinessRuleCategory })}
              >
                {BUSINESS_RULE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUSINESS_RULE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rule" className="sm:col-span-3">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={value.statement}
                maxLength={4000}
                disabled={!editable}
                onChange={(e) => setValue({ ...value, statement: e.target.value })}
              />
            )}
          </Field>
        </div>
        <ActivityLinks
          links={value.activities}
          processes={processes}
          editable={canEdit}
          onChange={(activities) => setValue({ ...value, activities })}
        />
        {rule ? (
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Enforced by validation rules</h3>
            {linkedValidations.length === 0 ? (
              <p className="text-xs text-slate-500">
                No validation rule references this business rule yet. Link one from a field's validation rules.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">
                {linkedValidations.map((v) => {
                  const f = fields.data?.find((x) => x.id === v.fieldId);
                  return (
                    <li key={v.id} className="text-xs text-slate-700">
                      <span className="font-mono text-slate-400">{v.refCode}</span> on {f ? `${f.refCode} ${f.name}` : 'a field'}:{' '}
                      {v.statement}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Links a rule to activities by their lineage key, so the link survives new process versions. */
function ActivityLinks({
  links,
  processes,
  editable,
  onChange,
}: {
  links: BusinessRule['activities'];
  processes: ProcessSummary[];
  editable: boolean;
  onChange: (links: BusinessRule['activities']) => void;
}) {
  const [processId, setProcessId] = useState('');
  const process = processes.find((p) => p.id === processId);
  const versionId = process ? (process.versions.find((v) => v.status === 'draft') ?? process.versions[0])?.id : undefined;
  const content = useQuery({
    queryKey: ['process-version', versionId ?? 'none'],
    enabled: Boolean(versionId),
    queryFn: () => backend.getVersionContent(versionId!),
  });
  // Labels for links come from each linked process's latest version.
  const linkedProcessIds = [...new Set(links.map((l) => l.processId))];
  const labels = useQuery({
    queryKey: ['business-rule-link-labels', ...linkedProcessIds],
    enabled: linkedProcessIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, string>();
      for (const id of linkedProcessIds) {
        const p = processes.find((x) => x.id === id);
        const v = p ? (p.versions.find((x) => x.status === 'draft') ?? p.versions[0]) : undefined;
        if (!v) continue;
        const c = await backend.getVersionContent(v.id);
        for (const n of c.graph.nodes) map.set(`${id}|${n.elementKey}`, `${n.refCode ? `${n.refCode} ` : ''}${n.label}`);
      }
      return map;
    },
  });

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Applies to activities</h3>
      {links.length === 0 ? <p className="text-xs text-slate-500">Not linked to any activity.</p> : null}
      <ul className="space-y-1">
        {links.map((l) => {
          const p = processes.find((x) => x.id === l.processId);
          return (
            <li key={`${l.processId}|${l.nodeKey}`} className="flex items-center gap-2 text-sm">
              <Link
                to={`/projects/${p?.project_id}/data/processes/${l.processId}?activity=${l.nodeKey}`}
                className="text-brand-700 hover:underline"
              >
                {p?.ref_code} {p?.name}
              </Link>
              <span className="text-slate-600">· {labels.data?.get(`${l.processId}|${l.nodeKey}`) ?? 'activity'}</span>
              {editable ? (
                <IconButton
                  label="Remove link"
                  icon={<X className="size-3.5" />}
                  onClick={() => onChange(links.filter((x) => !(x.processId === l.processId && x.nodeKey === l.nodeKey)))}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Process to link"
            className="h-8 w-auto min-w-48"
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
          >
            <option value="">Link to a process…</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.ref_code} {p.name}
              </option>
            ))}
          </Select>
          {content.data ? (
            <Select
              aria-label="Activity to link"
              className="h-8 w-auto min-w-56"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                onChange([...links, { processId, nodeKey: e.target.value }]);
              }}
            >
              <option value="">Choose an activity…</option>
              {dataActivities(content.data.graph)
                .filter((n) => !links.some((l) => l.processId === processId && l.nodeKey === n.elementKey))
                .map((n) => (
                  <option key={n.elementKey} value={n.elementKey}>
                    {n.refCode ? `${n.refCode} ` : ''}
                    {n.label}
                  </option>
                ))}
            </Select>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ImportDialog({
  projectId,
  findings,
  onClose,
}: {
  projectId: string;
  findings: PromotableFinding[];
  onClose: () => void;
}) {
  const promote = usePromoteFinding(projectId);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, BusinessRuleCategory>>({});
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Import business rules from processes"
      description="Rules identified in process descriptions. Importing adds them to the register as drafts, linked to their activities."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {promote.error ? (
        <Alert tone="error" className="mb-3">
          {errorMessage(promote.error)}
        </Alert>
      ) : null}
      {findings.length === 0 ? (
        <p className="text-sm text-slate-500">Every rule found in your processes is already in the register.</p>
      ) : null}
      <ul className="space-y-3">
        {findings.map((f) => (
          <li key={f.findingKey} className="space-y-2 rounded-md border border-slate-200 p-3 text-sm">
            <p className="text-xs text-slate-500">
              {f.processRef} {f.processName} · v{f.versionNumber}
            </p>
            <p className="text-slate-800">{f.statement}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Title"
                placeholder="Short title"
                className="h-8 min-w-56 flex-1"
                value={titles[f.findingKey] ?? ''}
                onChange={(e) => setTitles({ ...titles, [f.findingKey]: e.target.value })}
              />
              <Select
                aria-label="Category"
                className="h-8 w-40"
                value={categories[f.findingKey] ?? 'other'}
                onChange={(e) => setCategories({ ...categories, [f.findingKey]: e.target.value as BusinessRuleCategory })}
              >
                {BUSINESS_RULE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUSINESS_RULE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="primary"
                loading={promote.isPending && promote.variables?.findingKey === f.findingKey}
                onClick={() =>
                  promote.mutate({
                    versionId: f.versionId,
                    findingKey: f.findingKey,
                    title: titles[f.findingKey] ?? '',
                    category: categories[f.findingKey] ?? 'other',
                  })
                }
              >
                Import
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
