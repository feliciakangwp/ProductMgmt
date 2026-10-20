import {
  DATA_TYPE_LABELS,
  OUTPUT_KIND_LABELS,
  type DataProposal,
  type FieldDefinition,
  type ProcessGraph,
} from '@productflow/domain';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Dialog } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { MANDATORY_LABELS } from './format';
import { AiBadge } from './ActivityDataPanel';

/**
 * Review of AI-suggested inputs and outputs. Nothing changes until the
 * analyst picks what to keep; new fields are created as drafts.
 */
export function DataProposalDialog({
  proposal,
  model,
  graph,
  fields,
  onAccept,
  onClose,
}: {
  proposal: DataProposal;
  model: string;
  graph: ProcessGraph;
  fields: FieldDefinition[];
  onAccept: (selection: { fieldKeys: Set<string>; outputKeys: Set<string> }) => Promise<void>;
  onClose: () => void;
}) {
  const [fieldKeys, setFieldKeys] = useState(() => new Set(proposal.fields.filter((f) => !f.alreadyMapped).map((f) => f.key)));
  const [outputKeys, setOutputKeys] = useState(() => new Set(proposal.outputs.map((o) => o.key)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const draftByKey = new Map(proposal.newFields.map((f) => [f.key, f]));
  const activities = useMemo(() => {
    const keys = [...new Set([...proposal.fields.map((f) => f.nodeKey), ...proposal.outputs.map((o) => o.nodeKey)])];
    return keys.map((k) => graph.nodes.find((n) => n.elementKey === k)).filter((n): n is NonNullable<typeof n> => Boolean(n));
  }, [proposal, graph]);
  const newFieldCount = new Set(proposal.fields.filter((f) => fieldKeys.has(f.key) && f.newFieldKey).map((f) => f.newFieldKey))
    .size;
  const selected = fieldKeys.size + outputKeys.size;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  return (
    <Dialog
      open
      size="xl"
      onClose={busy ? () => undefined : onClose}
      title="Review suggested inputs and outputs"
      description={`Suggested by ${model}. Choose what to add; you can edit everything afterwards. Nothing is saved until you save the activity data.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={selected === 0}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onAccept({ fieldKeys, outputKeys });
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }}
          >
            Add {selected} selected
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {newFieldCount > 0 ? (
          <Alert>
            Adding these creates {newFieldCount} new field{newFieldCount > 1 ? 's' : ''} in the data dictionary as drafts. Confirm
            them in the dictionary once their details are right.
          </Alert>
        ) : null}
        {proposal.questions.length > 0 ? (
          <Alert tone="warning" title="Questions to resolve">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {proposal.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {activities.map((node) => {
          const items = proposal.fields.filter((f) => f.nodeKey === node.elementKey);
          const outs = proposal.outputs.filter((o) => o.nodeKey === node.elementKey);
          return (
            <section key={node.elementKey} className="rounded-md border border-slate-200">
              <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                <span className="mr-2 font-mono text-xs font-normal text-slate-500">{node.refCode ?? ''}</span>
                {node.label}
              </h3>
              <ul className="divide-y divide-slate-100">
                {items.map((item) => {
                  const existing = item.existingFieldId ? fieldById.get(item.existingFieldId) : undefined;
                  const draft = item.newFieldKey ? draftByKey.get(item.newFieldKey) : undefined;
                  const name = existing?.name ?? draft?.name ?? '';
                  const type = existing?.dataType ?? draft?.dataType;
                  return (
                    <li key={item.key}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={fieldKeys.has(item.key)}
                          disabled={item.alreadyMapped}
                          onChange={() => toggle(fieldKeys, setFieldKeys, item.key)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={item.direction === 'input' ? 'blue' : 'green'}>
                              {item.direction === 'input' ? 'Input' : 'Output'}
                            </Badge>
                            <span className="font-medium text-slate-900">{name}</span>
                            {type ? <span className="text-xs text-slate-500">{DATA_TYPE_LABELS[type]}</span> : null}
                            {existing ? (
                              <Badge title="Reuses an existing dictionary field">{existing.refCode}</Badge>
                            ) : (
                              <Badge tone="amber">New field</Badge>
                            )}
                            {item.direction === 'input' ? <Badge>Mandatory: {MANDATORY_LABELS[item.mandatory]}</Badge> : null}
                            {item.origin === 'inferred' ? <AiBadge /> : null}
                            {item.alreadyMapped ? <Badge tone="green">Already added</Badge> : null}
                          </span>
                          {item.mandatoryCondition ? (
                            <span className="block text-xs text-slate-600">Required when: {item.mandatoryCondition}</span>
                          ) : null}
                          {item.rationale ? <span className="block text-xs text-slate-500">{item.rationale}</span> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
                {outs.map((o) => (
                  <li key={o.key}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={outputKeys.has(o.key)}
                        onChange={() => toggle(outputKeys, setOutputKeys, o.key)}
                      />
                      <span>
                        <Badge tone="violet">{OUTPUT_KIND_LABELS[o.kind]}</Badge>{' '}
                        <span className="font-medium text-slate-900">{o.target}</span>
                        {o.description ? <span className="block text-xs text-slate-500">{o.description}</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {activities.length === 0 ? <p className="text-slate-500">Claude did not suggest any inputs or outputs.</p> : null}
      </div>
    </Dialog>
  );
}
