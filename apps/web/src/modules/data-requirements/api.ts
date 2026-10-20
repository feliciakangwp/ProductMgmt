import type { BusinessRule, FieldColumnMapping, FieldDefinition, PhysicalColumn, ValidationRule } from '@productflow/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { backend, type BusinessRuleInput, type NewFieldInput, type ValidationRuleInput } from '../../lib/backend';

export const dataKeys = {
  fields: (projectId: string) => ['data', projectId, 'fields'] as const,
  usages: (projectId: string) => ['data', projectId, 'usages'] as const,
  rules: (projectId: string) => ['data', projectId, 'rules'] as const,
  columns: (projectId: string) => ['data', projectId, 'columns'] as const,
  mappings: (projectId: string) => ['data', projectId, 'mappings'] as const,
  businessRules: (projectId: string) => ['data', projectId, 'business-rules'] as const,
  findings: (projectId: string) => ['data', projectId, 'promotable-findings'] as const,
  version: (versionId: string) => ['data', 'version', versionId] as const,
};

export const useFields = (projectId: string) =>
  useQuery({ queryKey: dataKeys.fields(projectId), queryFn: () => backend.listFields(projectId) });
export const useFieldUsages = (projectId: string) =>
  useQuery({ queryKey: dataKeys.usages(projectId), queryFn: () => backend.listFieldUsages(projectId) });
export const useValidationRules = (projectId: string) =>
  useQuery({ queryKey: dataKeys.rules(projectId), queryFn: () => backend.listValidationRules(projectId) });
export const usePhysicalColumns = (projectId: string) =>
  useQuery({ queryKey: dataKeys.columns(projectId), queryFn: () => backend.listPhysicalColumns(projectId) });
export const useColumnMappings = (projectId: string) =>
  useQuery({ queryKey: dataKeys.mappings(projectId), queryFn: () => backend.listColumnMappings(projectId) });
export const useBusinessRules = (projectId: string) =>
  useQuery({ queryKey: dataKeys.businessRules(projectId), queryFn: () => backend.listBusinessRules(projectId) });
export const usePromotableFindings = (projectId: string) =>
  useQuery({ queryKey: dataKeys.findings(projectId), queryFn: () => backend.listPromotableFindings(projectId) });

export function useVersionData(versionId: string | null) {
  return useQuery({
    queryKey: dataKeys.version(versionId ?? 'none'),
    enabled: Boolean(versionId),
    queryFn: () => backend.getVersionData(versionId!),
    // The editor owns the state once loaded.
    staleTime: Infinity,
  });
}

/** Mutation that refreshes the given project data queries afterwards. */
function useDataMutation<TInput, TResult>(
  projectId: string,
  fn: (input: TInput) => Promise<TResult>,
  refresh: (keyof typeof dataKeys)[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of refresh) {
        if (key === 'version') continue;
        void qc.invalidateQueries({ queryKey: (dataKeys[key] as (p: string) => readonly unknown[])(projectId) });
      }
    },
  });
}

export const useCreateFields = (projectId: string) =>
  useDataMutation(projectId, (fields: NewFieldInput[]) => backend.createFields(projectId, fields), ['fields']);
export const useUpdateField = (projectId: string) =>
  useDataMutation(projectId, (field: FieldDefinition) => backend.updateField(field), ['fields']);
export const useDeleteField = (projectId: string) =>
  useDataMutation(projectId, (fieldId: string) => backend.deleteField(fieldId), ['fields', 'rules', 'mappings']);

export const useCreateValidationRule = (projectId: string) =>
  useDataMutation(projectId, (input: ValidationRuleInput) => backend.createValidationRule(projectId, input), ['rules']);
export const useUpdateValidationRule = (projectId: string) =>
  useDataMutation(projectId, (rule: ValidationRule) => backend.updateValidationRule(rule), ['rules']);
export const useDeleteValidationRule = (projectId: string) =>
  useDataMutation(projectId, (ruleId: string) => backend.deleteValidationRule(ruleId), ['rules']);

export const useCreatePhysicalColumn = (projectId: string) =>
  useDataMutation(projectId, (input: Omit<PhysicalColumn, 'id'>) => backend.createPhysicalColumn(projectId, input), ['columns']);
export const useDeletePhysicalColumn = (projectId: string) =>
  useDataMutation(projectId, (columnId: string) => backend.deletePhysicalColumn(columnId), ['columns', 'mappings']);
export const useAddColumnMapping = (projectId: string) =>
  useDataMutation(projectId, (mapping: FieldColumnMapping) => backend.addColumnMapping(projectId, mapping), ['mappings']);
export const useRemoveColumnMapping = (projectId: string) =>
  useDataMutation(projectId, (m: { fieldId: string; columnId: string }) => backend.removeColumnMapping(m.fieldId, m.columnId), [
    'mappings',
  ]);

export const useCreateBusinessRule = (projectId: string) =>
  useDataMutation(projectId, (input: BusinessRuleInput) => backend.createBusinessRule(projectId, input), ['businessRules']);
export const useUpdateBusinessRule = (projectId: string) =>
  useDataMutation(projectId, (rule: BusinessRule) => backend.updateBusinessRule(rule), ['businessRules']);
export const useDeleteBusinessRule = (projectId: string) =>
  useDataMutation(projectId, (ruleId: string) => backend.deleteBusinessRule(ruleId), ['businessRules', 'rules']);
export const usePromoteFinding = (projectId: string) =>
  useDataMutation(projectId, (input: Parameters<typeof backend.promoteFinding>[0]) => backend.promoteFinding(input), [
    'businessRules',
    'findings',
  ]);
