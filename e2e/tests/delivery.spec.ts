import { expect, test, type Page } from '@playwright/test';
import { DEBT_WRITE_OFF_DESCRIPTION } from '@productflow/domain/testing';

const unique = Date.now().toString(36).toUpperCase().slice(-5);
const nav = (page: Page, label: string) => page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();

/** Signs up, creates a project and an approved process map. */
async function approvedProcess(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Avery Admin');
  await page.getByLabel('Email').fill(`avery-${unique}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.getByLabel('Project name').fill('Delivery');
  await page.getByLabel('Project key').fill(`D${unique}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Create a process' }).click();
  await page.getByLabel('Process name').fill('Debt write-off');
  await page.getByLabel('Process description (optional)').fill(DEBT_WRITE_OFF_DESCRIPTION);
  await page.getByRole('button', { name: 'Create and open designer' }).click();
  await page.getByRole('button', { name: 'Analyse & Generate Process Map' }).click();
  await page.getByRole('button', { name: 'Accept into draft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve version 1' });
  const ack = approve.getByLabel(/I have reviewed/);
  if (await ack.count()) await ack.check();
  await approve.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Version 1 is approved. It cannot be changed.')).toBeVisible();
}

test('from approved process to stories, sprint, Kanban, UAT and defect', async ({ page }) => {
  await approvedProcess(page);

  // Phase 3: AI-generated stories are reviewed before they are saved.
  await nav(page, 'Tech User Story');
  await page.getByRole('button', { name: 'Generate from process' }).click();
  await page.getByRole('dialog', { name: 'Generate user stories' }).getByRole('button', { name: 'Generate stories' }).click();
  const review = page.getByRole('dialog', { name: 'Review suggested user stories' });
  await expect(review.getByText('Retrieve debt record', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: /Add \d+ as drafts/ }).click();
  await expect(page.getByText(/stories added as drafts/)).toBeVisible();

  await page.getByRole('button', { name: /US-\d+\s+Retrieve debt record/ }).click();
  let story = page.getByRole('dialog', { name: /US-\d+ Retrieve debt record/ });
  await story.getByRole('button', { name: 'Submit for review' }).click();
  await story.getByRole('button', { name: 'Approve' }).click();
  await story.getByRole('button', { name: 'Add to backlog' }).click();
  await expect(story.getByText('Added to Backlog').first()).toBeVisible();
  await expect(story.getByLabel('Title')).toBeDisabled();

  // Technical stories stay "Proposed" until a developer (or admin) confirms the design.
  await story.getByRole('button', { name: 'Generate technical stories' }).click();
  const techReview = page.getByRole('dialog', { name: 'Review proposed technical stories' });
  await techReview.getByRole('button', { name: /Add \d+ as drafts/ }).click();
  await expect(story.getByText(/technical stor(y|ies) added as drafts/)).toBeVisible();
  await story.getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.getByRole('button', { name: /TS-001\s+API: Retrieve debt record/ }).click();
  story = page.getByRole('dialog', { name: /TS-001/ });
  await expect(story.getByText('Proposed: not yet confirmed by a developer')).toBeVisible();
  await expect(story.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await story.getByRole('button', { name: 'Confirm design' }).click();
  await story.getByRole('button', { name: 'Save changes' }).click();
  await expect(story.getByText('Confirmed design')).toBeVisible();
  await story.getByRole('button', { name: 'Submit for review' }).click();
  await story.getByRole('button', { name: 'Approve' }).click();
  await story.getByRole('button', { name: 'Add to backlog' }).click();
  await expect(story.getByText('Added to Backlog').first()).toBeVisible();
  await story.getByRole('button', { name: 'Close', exact: true }).last().click();

  // Phase 4: estimate in the backlog, plan a sprint, work the board.
  await nav(page, 'Product Backlog');
  await page.getByLabel('Estimate of TS-001').fill('6');
  await page.getByLabel('Estimate of TS-001').blur();
  await page.getByLabel('Developer for TS-001').selectOption({ label: 'Avery Admin' });
  await expect(page.getByLabel('Developer for TS-001')).toHaveValue(/.+/);

  await nav(page, 'Sprint Planning');
  await page.getByRole('button', { name: 'New sprint' }).click();
  const sprintForm = page.getByRole('dialog', { name: 'New sprint' });
  await sprintForm.getByLabel('Sprint name').fill('Sprint 1');
  await sprintForm.getByLabel('Capacity (hours)').fill('4');
  await sprintForm.getByRole('button', { name: 'Create sprint' }).click();
  await page.getByLabel('Add a backlog item').selectOption({ label: 'TS-001 API: Retrieve debt record (6 h)' });
  await expect(page.getByText(/over capacity by 2 h/)).toBeVisible();
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('button', { name: 'Complete sprint' })).toBeVisible();

  await nav(page, 'Development Kanban');
  await page.getByRole('button', { name: 'TS-001 API: Retrieve debt record' }).click();
  const card = page.getByRole('dialog', { name: 'TS-001 API: Retrieve debt record' });
  // Strict workflow: columns cannot be skipped.
  await expect(card.getByLabel('Move to').locator('option', { hasText: 'In Development' })).toBeDisabled();
  for (const column of ['In Planning', 'In Development', 'Ready for Testing', 'In Testing', 'Completed']) {
    await card.getByLabel('Move to').selectOption({ label: column });
    await expect(card.getByLabel('Move to')).toHaveValue(column.toLowerCase().replace(/[ -]/g, '_').replace('to_do', 'todo'));
  }
  await expect(card.getByText(/Moved\s+in testing → completed/)).toBeVisible();
  await card.getByRole('button', { name: 'Close', exact: true }).last().click();

  // Phase 5: scenarios become Ready for UAT once their technical stories are completed.
  await nav(page, 'Business User Story');
  await page.getByRole('button', { name: 'Generate from stories' }).click();
  await page
    .getByRole('dialog', { name: 'Generate business scenarios' })
    .getByRole('button', { name: 'Generate scenarios' })
    .click();
  await page
    .getByRole('dialog', { name: 'Review suggested scenarios' })
    .getByRole('button', { name: /Add \d+ as drafts/ })
    .click();
  await page.getByRole('button', { name: /BS-001/ }).click();
  const scenario = page.getByRole('dialog', { name: /BS-001/ });
  await expect(scenario.getByText('The scenario has not been approved')).toBeVisible();
  await scenario.getByRole('button', { name: 'Approve' }).click();
  await expect(scenario.getByRole('button', { name: 'Return to draft' })).toBeVisible();
  await scenario.getByLabel('Prerequisites are met').click();
  await expect(scenario.getByLabel('Prerequisites are met')).toBeChecked();
  await expect(scenario.getByText('Ready for UAT')).toBeVisible();
  await scenario.getByRole('button', { name: 'Close', exact: true }).last().click();

  await nav(page, 'Business Testing');
  await page.getByRole('button', { name: 'Start test' }).click();
  await expect(page.getByRole('heading', { name: /TE-001/ })).toBeVisible();
  const step1 = page.getByRole('listitem').filter({ hasText: 'Step 1:' });
  await step1.getByLabel('Result', { exact: true }).selectOption('fail');
  await step1.getByLabel('Actual result').fill('Error 500 shown');
  await step1.getByRole('button', { name: 'Save step 1' }).click();
  await expect(step1.locator('span', { hasText: /^Fail$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Raise defect for step 1' }).click();
  const defect = page.getByRole('dialog', { name: 'Raise a defect' });
  await expect(defect.getByLabel('Actual result')).toHaveValue('Error 500 shown');
  await defect.getByRole('button', { name: 'Raise defect' }).click();
  await expect(page.getByRole('link', { name: 'DEF-001' })).toBeVisible();
  for (const item of await page
    .getByRole('listitem')
    .filter({ hasText: /^Step [2-9]:/ })
    .all()) {
    await item.getByLabel('Result', { exact: true }).selectOption('pass');
    await item.getByLabel('Actual result').fill('As expected');
    await item.getByRole('button', { name: /Save step/ }).click();
    await expect(item.locator('span', { hasText: /^Pass$/ })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Complete test: failed' }).click();
  await expect(page.getByText('Completed: failed')).toBeVisible();
  await expect(page.getByLabel('Result', { exact: true })).toHaveCount(0);

  await nav(page, 'Defect Tracking');
  await expect(page.getByRole('row', { name: /DEF-001/ })).toContainText('BS-001');
  await expect(page.getByRole('row', { name: /DEF-001/ })).toContainText('TS-001');

  // Phase 6 and 7: metrics from stored data, and end-to-end traceability.
  await nav(page, 'Delivery Dashboard');
  await expect(page.getByText('UAT pass rate').locator('..')).toContainText('0%');
  await expect(page.getByText('Open defects').locator('..')).toContainText('1');
  await nav(page, 'Traceability');
  const activity = await page.getByLabel('Activity').locator('option', { hasText: 'Retrieve debt record' }).getAttribute('value');
  await page.getByLabel('Activity').selectOption(activity!);
  await expect(page.getByText(/^US-\d+$/)).toBeVisible();
  await expect(page.getByText('BS-001', { exact: true })).toBeVisible();
});
