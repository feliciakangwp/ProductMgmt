import { PROCESS_TYPES, type ProcessType } from '@productflow/domain';
import { Field, Input, Select } from '../../components/ui';
import { PROCESS_TYPE_LABELS } from './api';

export interface ProcessDetails {
  name: string;
  processType: ProcessType;
  owner: string;
  businessUnit: string;
}

export function ProcessDetailsFields({
  value,
  onChange,
  disabled,
}: {
  value: ProcessDetails;
  onChange: (next: ProcessDetails) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Process name" className="sm:col-span-2">
        {(id) => (
          <Input
            id={id}
            value={value.name}
            maxLength={200}
            required
            disabled={disabled}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="Debt write-off"
          />
        )}
      </Field>
      <Field label="State">
        {(id) => (
          <Select
            id={id}
            value={value.processType}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, processType: e.target.value as ProcessType })}
          >
            {PROCESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROCESS_TYPE_LABELS[t]} {t === 'as_is' ? '(current state)' : '(target state)'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Process owner">
        {(id) => (
          <Input
            id={id}
            value={value.owner}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, owner: e.target.value })}
            placeholder="Head of Finance Operations"
          />
        )}
      </Field>
      <Field label="Business unit" className="sm:col-span-2">
        {(id) => (
          <Input
            id={id}
            value={value.businessUnit}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, businessUnit: e.target.value })}
            placeholder="Finance"
          />
        )}
      </Field>
    </div>
  );
}
