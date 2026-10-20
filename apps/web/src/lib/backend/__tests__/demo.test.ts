import { EMPTY_RULE_PARAMS, toSaveDataPayload } from '@productflow/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackend } from '../demo';

/**
 * The demo backend mirrors the database rules in supabase/migrations; these
 * tests pin the behaviour the shared demo relies on.
 */
const backend = createBackend();

async function seeded() {
  const [project] = await backend.listMyProjects('demo-user');
  const processes = await backend.listProcesses(project!.id);
  const writeOff = processes.find((p) => p.name === 'Debt write-off')!;
  const draft = writeOff.versions.find((v) => v.status === 'draft')!;
  const approved = writeOff.versions.find((v) => v.status === 'approved')!;
  return { project: project!, writeOff, draft, approved };
}

beforeEach(() => backend.demo!.reset());

describe('demo backend: seed data', () => {
  it('starts with an approved v1, a draft v2 and data requirements on both', async () => {
    const { project, draft, approved } = await seeded();
    expect(project.role).toBe('admin');
    const [d, a] = await Promise.all([backend.getVersionData(draft.id), backend.getVersionData(approved.id)]);
    expect(d.requirements.fields.length).toBeGreaterThan(10);
    expect(d.requirements.fields.map((f) => f.elementKey).sort()).toEqual(a.requirements.fields.map((f) => f.elementKey).sort());
    const fields = await backend.listFields(project.id);
    expect(fields.map((f) => f.refCode)).toContain('FLD-001');
    expect(
      fields
        .filter((f) => f.status === 'draft')
        .map((f) => f.name)
        .sort(),
    ).toEqual(['Approver ID', 'Rejection Reason']);
    const rules = await backend.listBusinessRules(project.id);
    expect(rules.map((r) => [r.refCode, r.status])).toEqual([
      ['BR-001', 'approved'],
      ['BR-002', 'draft'],
    ]);
    expect(await backend.listPromotableFindings(project.id)).toEqual([expect.objectContaining({ promoted: true })]);
  });
});

describe('demo backend: rules mirrored from the database', () => {
  it('rejects stale and frozen data saves', async () => {
    const { draft, approved } = await seeded();
    const data = await backend.getVersionData(draft.id);
    const content = await backend.getVersionContent(draft.id);
    const nodeKeys = new Set(content.graph.nodes.map((n) => n.elementKey));
    const payload = toSaveDataPayload({
      versionId: draft.id,
      expectedRevision: data.dataRevision,
      requirements: data.requirements,
      nodeKeys,
    });
    expect(await backend.saveVersionData(payload)).toBe(data.dataRevision + 1);
    await expect(backend.saveVersionData(payload)).rejects.toMatchObject({ code: 'PF409' });
    await expect(
      backend.saveVersionData({ ...payload, p_version_id: approved.id, p_expected_revision: 2 }),
    ).rejects.toMatchObject({ code: 'PF423' });
  });

  it('protects fields in use and approved business rules', async () => {
    const { project } = await seeded();
    const [debtId] = await backend.listFields(project.id);
    await expect(backend.deleteField(debtId!.id)).rejects.toMatchObject({ code: 'PF423' });
    const [approved, draft] = await backend.listBusinessRules(project.id);
    await expect(backend.deleteBusinessRule(approved!.id)).rejects.toMatchObject({ code: 'PF423' });
    await expect(backend.updateBusinessRule({ ...approved!, statement: 'Changed' })).rejects.toMatchObject({ code: 'PF423' });
    await expect(backend.updateBusinessRule({ ...draft!, revision: 99 })).rejects.toMatchObject({ code: 'PF409' });
  });

  it('enforces roles: developers read only, analysts cannot approve rules', async () => {
    const { project } = await seeded();
    backend.demo!.setMyRole(project.id, 'business_analyst');
    const [, draft] = await backend.listBusinessRules(project.id);
    await expect(backend.updateBusinessRule({ ...draft!, status: 'approved' })).rejects.toMatchObject({ code: '42501' });
    backend.demo!.setMyRole(project.id, 'developer');
    await expect(
      backend.createFields(project.id, [
        {
          name: 'X',
          description: '',
          dataType: 'string',
          allowedValues: [],
          defaultValue: '',
          source: 'user_entered',
          sourceDetail: '',
          origin: 'manual',
        },
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await backend.listFields(project.id)).length).toBeGreaterThan(0);
  });

  it('creates rules with sequential ref codes and keeps optimistic locking on fields', async () => {
    const { project } = await seeded();
    const [field] = await backend.listFields(project.id);
    const rule = await backend.createValidationRule(project.id, {
      fieldId: field!.id,
      ruleType: 'required',
      params: EMPTY_RULE_PARAMS,
      statement: 'Debt ID is required.',
      errorMessage: '',
      sourceText: null,
      origin: 'manual',
      status: 'draft',
      businessRuleId: null,
    });
    expect(rule.refCode).toBe('VR-005');
    const updated = await backend.updateField({ ...field!, description: 'New' });
    expect(updated.revision).toBe(field!.revision + 1);
    await expect(backend.updateField({ ...field!, description: 'Stale' })).rejects.toMatchObject({ code: 'PF409' });
  });

  it('copies data requirements into a new draft and drops them with removed activities', async () => {
    const { draft } = await seeded();
    const content = await backend.getVersionContent(draft.id);
    const submit = content.graph.nodes.find((n) => n.label === 'Submit request to supervisor')!;
    const { toSavePayload } = await import('@productflow/domain');
    const graph = {
      nodes: content.graph.nodes.filter((n) => n !== submit),
      edges: content.graph.edges.filter((e) => e.source !== submit.elementKey && e.target !== submit.elementKey),
    };
    await backend.saveDraft(
      toSavePayload({
        versionId: draft.id,
        expectedRevision: content.version.revision,
        description: '',
        graph,
        findings: content.findings,
      }),
    );
    const data = await backend.getVersionData(draft.id);
    expect(data.requirements.fields.some((f) => f.nodeKey === submit.elementKey)).toBe(false);
  });

  it('falls back to labelled sample responses when Claude is not available', async () => {
    const { draft } = await seeded();
    expect(await backend.demo!.ai.mode()).toBe('samples');
    const result = await backend.suggestFields({ versionId: draft.id });
    expect(result.model).toBe('Sample responses (offline demo)');
    expect(result.proposal.fields.length).toBeGreaterThan(0);
  });
});

describe('demo backend: delivery', () => {
  it('seeds a delivery history through the delivery service', async () => {
    const { project } = await seeded();
    const snapshot = await backend.delivery.snapshot({ projectId: project.id });
    expect(snapshot.sprints.map((s) => [s.name, s.status])).toEqual([
      ['Sprint 1', 'completed'],
      ['Sprint 2', 'active'],
    ]);
    expect(snapshot.stories.filter((s) => s.storyType === 'technical').length).toBeGreaterThanOrEqual(3);
    expect(snapshot.stories.some((s) => s.blocked)).toBe(true);
    expect(snapshot.executions.map((e) => e.status)).toEqual(['failed']);
    expect(snapshot.defects.map((d) => [d.refCode, d.status])).toEqual([['DEF-001', 'in_progress']]);
    expect(snapshot.events.filter((e) => e.kind === 'work_status').length).toBeGreaterThan(10);
  });

  it('applies the viewer\'s role and rolls back failed operations', async () => {
    const { project } = await seeded();
    await backend.delivery.snapshot({ projectId: project.id });
    backend.demo!.setMyRole(project.id, 'business_user');
    await expect(
      backend.delivery.createStory({ projectId: project.id, storyType: 'functional', content: { title: 'Nope' } }),
    ).rejects.toMatchObject({ code: '42501' });
    backend.demo!.setMyRole(project.id, 'admin');
    const before = await backend.delivery.snapshot({ projectId: project.id });
    const sprint = before.sprints.find((s) => s.status === 'active')!;
    await expect(
      backend.delivery.setSprintStatus({ sprintId: sprint.id, revision: sprint.revision + 5, status: 'completed' }),
    ).rejects.toMatchObject({ code: 'PF409' });
    expect((await backend.delivery.snapshot({ projectId: project.id })).events.length).toBe(before.events.length);
  });
});
