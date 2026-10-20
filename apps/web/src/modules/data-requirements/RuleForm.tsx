import {
  EMPTY_RULE_PARAMS,
  RULE_TYPE_LABELS,
  RULE_TYPES,
  ruleParamProblems,
  type BusinessRule,
  type FieldDefinition,
  type RuleParams,
  type RuleType,
} from '@productflow/domain';
import { useState } from 'react';
import { Alert, Button, Field, Input, Select } from '../../components/ui';

export interface RuleFormValue {
  ruleType: RuleType;
  params: RuleParams;
  statement: string;
  errorMessage: string;
  businessRuleId: string | null;
}

const numberOrNull = (value: string): number | null =>
  value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value);
const textOrNull = (value: string): string | null => (value.trim() ? value : null);

/** Create or edit a structured validation rule. Shows only the parameters the rule type uses. */
export function RuleForm({
  initial,
  field,
  fields,
  businessRules,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: RuleFormValue;
  field: FieldDefinition;
  fields: FieldDefinition[];
  businessRules: BusinessRule[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: RuleFormValue) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RuleFormValue>(
    initial ?? { ruleType: 'required', params: EMPTY_RULE_PARAMS, statement: '', errorMessage: '', businessRuleId: null },
  );
  const p = value.params;
  const setParam = (patch: Partial<RuleParams>) => setValue({ ...value, params: { ...p, ...patch } });
  const problems = ruleParamProblems(p);
  const t = value.ruleType;

  return (
    <form
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length === 0 && value.statement.trim()) onSubmit({ ...value, statement: value.statement.trim() });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rule type">
          {(id) => (
            <Select id={id} value={t} onChange={(e) => setValue({ ...value, ruleType: e.target.value as RuleType })}>
              {RULE_TYPES.map((r) => (
                <option key={r} value={r}>
                  {RULE_TYPE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Enforces business rule (optional)">
          {(id) => (
            <Select
              id={id}
              value={value.businessRuleId ?? ''}
              onChange={(e) => setValue({ ...value, businessRuleId: e.target.value || null })}
            >
              <option value="">None</option>
              {businessRules
                .filter((b) => b.status !== 'retired')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.refCode} {b.title}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {t === 'range' ? (
          <>
            <Field label="Minimum">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  value={p.min ?? ''}
                  onChange={(e) => setParam({ min: numberOrNull(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Maximum">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  value={p.max ?? ''}
                  onChange={(e) => setParam({ max: numberOrNull(e.target.value) })}
                />
              )}
            </Field>
            <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
              <input type="checkbox" checked={p.exclusive} onChange={(e) => setParam({ exclusive: e.target.checked })} />
              Exclusive (greater than / less than, rather than at least / at most)
            </label>
          </>
        ) : null}
        {t === 'length' ? (
          <>
            <Field label="Minimum length">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  value={p.minLength ?? ''}
                  onChange={(e) => setParam({ minLength: numberOrNull(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Maximum length">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  value={p.maxLength ?? ''}
                  onChange={(e) => setParam({ maxLength: numberOrNull(e.target.value) })}
                />
              )}
            </Field>
          </>
        ) : null}
        {t === 'format' ? (
          <Field
            label="Format"
            hint='A named format such as "email", or a regular expression such as /^[A-Z]{2}\d{6}$/'
            className="sm:col-span-2"
          >
            {(id) => (
              <Input id={id} value={p.pattern ?? ''} onChange={(e) => setParam({ pattern: textOrNull(e.target.value) })} />
            )}
          </Field>
        ) : null}
        {t === 'cross_field' ? (
          <Field label="Other field">
            {(id) => (
              <Select id={id} value={p.otherFieldId ?? ''} onChange={(e) => setParam({ otherFieldId: e.target.value || null })}>
                <option value="">Choose a field</option>
                {fields
                  .filter((f) => f.id !== field.id && f.status !== 'deprecated')
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.refCode} {f.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : null}
        {t === 'conditional_required' || t === 'cross_field' ? (
          <Field label="Condition" className={t === 'conditional_required' ? 'sm:col-span-2' : ''}>
            {(id) => (
              <Input
                id={id}
                value={p.condition ?? ''}
                maxLength={1000}
                onChange={(e) => setParam({ condition: textOrNull(e.target.value) })}
              />
            )}
          </Field>
        ) : null}
        {t === 'lookup' || t === 'duplicate' ? (
          <Field label={t === 'lookup' ? 'Must exist in' : 'Must be unique within'} className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={p.lookupSource ?? ''}
                placeholder="e.g. Debt records"
                onChange={(e) => setParam({ lookupSource: textOrNull(e.target.value) })}
              />
            )}
          </Field>
        ) : null}
        <Field label="Rule" hint="One precise, testable sentence." className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={value.statement}
              maxLength={2000}
              required
              placeholder={`${field.name} must …`}
              onChange={(e) => setValue({ ...value, statement: e.target.value })}
            />
          )}
        </Field>
        <Field label="Error message shown to users" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={value.errorMessage}
              maxLength={500}
              onChange={(e) => setValue({ ...value, errorMessage: e.target.value })}
            />
          )}
        </Field>
      </div>
      {problems.length > 0 ? <Alert tone="error">{problems.join('; ')}.</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          type="submit"
          loading={busy}
          disabled={problems.length > 0 || !value.statement.trim()}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
