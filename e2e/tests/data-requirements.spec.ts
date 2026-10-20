import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEBT_WRITE_OFF_DESCRIPTION, OUTSTANDING_AMOUNT_RULE_TEXT } from '@productflow/domain/testing';

const unique = Date.now().toString(36).toUpperCase().slice(-5);
const node = (page: Page, text: string) => page.locator('.react-flow__node', { hasText: text });
/** The button showing a field's ref code and name in an activity's field table. */
const fieldButton = (scope: Locator, name: string) => scope.getByRole('button', { name: new RegExp(`^FLD-\\d+\\s*${name}$`) });

/** Signs up, creates a project and a process, and saves an analysed map. */
async function processWithMap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Dana Analyst');
  await page.getByLabel('Email').fill(`dana-${unique}@example.com`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.getByLabel('Project name').fill('Data Requirements');
  await page.getByLabel('Project key').fill(`R${unique}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Create a process' }).click();
  await page.getByLabel('Process name').fill('Debt write-off');
  await page.getByLabel('Process description (optional)').fill(DEBT_WRITE_OFF_DESCRIPTION);
  await page.getByRole('button', { name: 'Create and open designer' }).click();
  await page.getByRole('button', { name: 'Analyse & Generate Process Map' }).click();
  await page.getByRole('button', { name: 'Accept into draft' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
}

test('analyst defines inputs, outputs, validation rules and business rules', async ({ page }) => {
  await processWithMap(page);

  // From the map, open an activity's inputs and outputs.
  await node(page, 'Submit request to supervisor').click();
  await page.getByRole('link', { name: 'Inputs & outputs of this activity' }).click();
  await expect(page.getByRole('heading', { name: 'Submit request to supervisor' })).toBeVisible();
  await expect(page.getByText('No input fields yet.')).toBeVisible();

  // AI suggestions are reviewed before anything is added.
  await page.getByRole('button', { name: 'For all activities' }).click();
  const review = page.getByRole('dialog', { name: 'Review suggested inputs and outputs' });
  await expect(review).toBeVisible();
  await expect(review.getByText(/creates 13 new fields in the data dictionary as drafts/)).toBeVisible();
  await expect(review.getByText('Is a supporting document always required, or only above a threshold amount?')).toBeVisible();
  // Leave out the debt-status change on the last activity.
  await review.locator('label', { hasText: 'Debt status: Written Off' }).getByRole('checkbox').uncheck();
  await review.getByRole('button', { name: /Add \d+ selected/ }).click();
  await expect(review).toBeHidden();

  const inputs = page.locator('section', { has: page.getByRole('heading', { name: 'Input fields' }) });
  await expect(fieldButton(inputs, 'Write-Off Reason')).toBeVisible();
  await expect(inputs.getByLabel('Condition: Supporting Document')).toHaveValue(
    'Required when the outstanding amount exceeds $10,000',
  );
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // Edit: make the reason conditional and add a field of our own.
  await inputs.getByLabel('Mandatory: Write-Off Reason').selectOption('conditional');
  await expect(page.getByText(/Write-Off Reason is conditionally mandatory in .* but the condition is not stated/)).toBeVisible();
  await inputs.getByLabel('Condition: Write-Off Reason').fill('Unless the debtor is deceased');
  await page.getByRole('button', { name: 'Add input field' }).click();
  await page.getByRole('combobox', { name: 'Add input field' }).fill('Debtor Address');
  await page.getByRole('button', { name: 'Create field “Debtor Address”' }).click();
  await page.getByRole('button', { name: 'Create and add' }).click();
  await expect(fieldButton(inputs, 'Debtor Address')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  // Field details: translate validation logic, confirm the rule and the field, map a column.
  await fieldButton(inputs, 'Outstanding Amount').click();
  const fieldDialog = page.getByRole('dialog', { name: /Outstanding Amount/ });
  await fieldDialog.getByLabel('Describe the validation logic in plain language').fill(OUTSTANDING_AMOUNT_RULE_TEXT);
  await fieldDialog.getByRole('button', { name: 'Translate with AI' }).click();
  await expect(fieldDialog.getByText('Director approval above $10,000')).toBeVisible();
  await fieldDialog.getByRole('button', { name: 'Add 2 as drafts' }).click();
  await expect(fieldDialog.locator('p', { hasText: /^Outstanding amount must be greater than zero\.$/ })).toBeVisible();
  await fieldDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(fieldDialog.getByRole('listitem').filter({ hasText: 'VR-001' })).toContainText('Confirmed');
  await fieldDialog.getByRole('button', { name: 'Confirm field' }).click();
  await expect(fieldDialog.getByRole('button', { name: 'Confirm field' })).toHaveCount(0);
  await fieldDialog.getByRole('button', { name: 'New column' }).click();
  await fieldDialog.getByLabel('System', { exact: true }).fill('Debt Management DB');
  await fieldDialog.getByLabel('Table', { exact: true }).fill('debts');
  await fieldDialog.getByLabel('Column', { exact: true }).fill('principal_cents');
  await fieldDialog.getByRole('button', { name: 'Create column' }).click();
  await fieldDialog.getByLabel('Transformation').fill('principal_cents / 100');
  await fieldDialog.getByRole('button', { name: 'Map column' }).click();
  await expect(fieldDialog.getByText('Debt Management DB · debts.principal_cents')).toBeVisible();
  await expect(fieldDialog.getByText(/PRC-001 Debt write-off · v1/).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Reopen later: everything is persisted.
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Activities' })
    .getByRole('button', { name: /Submit request to supervisor/ })
    .click();
  await expect(inputs.getByLabel('Condition: Write-Off Reason')).toHaveValue('Unless the debtor is deceased');
  await expect(fieldButton(inputs, 'Debtor Address')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Activities' })
    .getByRole('button', { name: /Update debt status to Written Off/ })
    .click();
  await expect(page.getByText('Audit record')).toHaveCount(0); // the record update was suggested on another activity
  await expect(page.locator('input[value="Debt status: Written Off"]')).toHaveCount(0);

  // Data dictionary
  await page.getByRole('link', { name: 'Back to data requirements' }).click();
  await page.getByRole('link', { name: 'Data dictionary' }).click();
  const outstanding = page.getByRole('row', { name: /^FLD-\d+ Outstanding Amount/ });
  await expect(outstanding).toContainText('Confirmed');
  await expect(page.getByRole('row', { name: /^FLD-\d+ Write-Off Reason/ })).toContainText('Draft');
  await expect(page.getByText('debts.principal_cents')).toBeVisible();

  // Business rules: the translated rule is in the register; import the rule found in the description.
  await page.getByRole('link', { name: 'Business rules' }).click();
  await expect(page.getByText('BR-001')).toBeVisible();
  await page.getByRole('button', { name: /Import from processes \(1\)/ }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import business rules from processes' });
  await importDialog.getByLabel('Title').fill('Five-year eligibility');
  await importDialog.getByLabel('Category').selectOption('eligibility');
  await importDialog.getByRole('button', { name: 'Import' }).click();
  await expect(importDialog.getByText('Every rule found in your processes is already in the register.')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /BR-002 Five-year eligibility/ }).click();
  const ruleDialog = page.getByRole('dialog', { name: /BR-002/ });
  await expect(ruleDialog.getByRole('link', { name: /PRC-001 Debt write-off/ })).toBeVisible();
  await ruleDialog.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('button', { name: /BR-002 Five-year eligibility/ })).toContainText('Approved');

  // Approving the process lists the open data issues for acknowledgement.
  await page.getByRole('link', { name: 'Process Designer' }).click();
  await page.getByRole('link', { name: 'Debt write-off' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve version 1' });
  await expect(approve.getByText(/inputs & outputs issue/)).toBeVisible();
  await expect(approve.getByText(/Write-Off Reason is still a draft/)).toBeVisible();
});
