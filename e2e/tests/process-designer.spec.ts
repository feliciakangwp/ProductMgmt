import { expect, test, type Page } from '@playwright/test';
import { DEBT_WRITE_OFF_DESCRIPTION } from '@productflow/domain/testing';

const unique = Date.now().toString(36).toUpperCase().slice(-5);

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
}

const node = (page: Page, text: string) => page.locator('.react-flow__node', { hasText: text });

test('analyst creates, analyses, edits, saves, reopens and approves a process', async ({ page }) => {
  // 1–2. Open ProductFlow AI and create a project.
  await signUp(page, 'Avery Analyst', `avery-${unique}@example.com`);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Development Kanban/ })).toHaveAttribute('href', '/projects');
  await page.getByRole('button', { name: 'Create your first project' }).click();
  await page.getByLabel('Project name').fill('Debt Management');
  await page.getByLabel('Project key').fill(`D${unique}`);
  await page.getByRole('button', { name: 'Create project' }).click();

  // 3–4. Create a business process with a natural-language description.
  await expect(page.getByRole('heading', { name: 'Business processes' })).toBeVisible();
  await page.getByRole('button', { name: 'Create a process' }).click();
  const dialog = page.getByRole('dialog', { name: 'New process' });
  await dialog.getByLabel('Process name').fill('Debt write-off');
  await dialog.getByLabel('State').selectOption('to_be');
  await dialog.getByLabel('Process owner').fill('Head of Finance');
  await dialog.getByLabel('Business unit').fill('Finance');
  await dialog.getByLabel('Process description (optional)').fill(DEBT_WRITE_OFF_DESCRIPTION);
  await dialog.getByRole('button', { name: 'Create and open designer' }).click();

  await expect(page.getByRole('heading', { name: 'Debt write-off' })).toBeVisible();
  await expect(page.getByText('Owner: Head of Finance · Unit: Finance')).toBeVisible();
  await expect(page.getByLabel('Process description', { exact: true }).last()).toHaveValue(DEBT_WRITE_OFF_DESCRIPTION);

  // 5–6. Analyse and review the generated map before accepting it.
  await page.getByRole('button', { name: 'Analyse & Generate Process Map' }).click();
  const review = page.getByRole('dialog', { name: 'Review the generated process map' });
  await expect(review).toBeVisible();
  await expect(review.getByText('Debt Write-Off', { exact: true })).toBeVisible();
  await expect(review.getByText(/2 steps were inferred/)).toBeVisible();
  await expect(review.getByText(/Accepting adds 3 new actors/)).toBeVisible();
  await review.getByRole('button', { name: 'Accept into draft' }).click();
  await expect(review).toBeHidden();

  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(node(page, 'Review write-off request')).toContainText('Supervisor');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // 10. Validation warnings, including the AI's open question.
  await page.getByRole('tab', { name: /Validation/ }).click();
  await expect(page.getByText('What happens to an ineligible request? The description does not say.')).toBeVisible();

  // 7. Edit activities, decisions and connections.
  await node(page, 'Retrieve debt record').click();
  await page.getByLabel('Name').fill('Retrieve debt record from ledger');
  await expect(node(page, 'Retrieve debt record from ledger')).toBeVisible();

  await node(page, 'Outstanding more than five years?').click();
  await page.getByLabel('Decision question').fill('Outstanding more than 5 years?');
  await page.getByLabel('Responsible actor').selectOption({ label: 'Supervisor' });
  await expect(node(page, 'Outstanding more than 5 years?')).toContainText('Supervisor');

  await page.locator('.react-flow__edge', { hasText: 'Rejected' }).locator('.react-flow__edge-textbg').click();
  await expect(page.getByText('Connection', { exact: true })).toBeVisible();
  await page.getByLabel('Condition').fill('Supervisor rejects the write-off');

  // Add an activity, see it flagged as disconnected, then connect it by dragging between handles.
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const added = node(page, 'New activity');
  await expect(added).toBeVisible();
  await page.getByLabel('Name').fill('Notify debtor');
  await page.getByRole('tab', { name: /Validation/ }).click();
  await expect(page.getByText('"Notify debtor" is not connected to the process.')).toBeVisible();

  await page.getByRole('button', { name: 'Auto layout' }).click();
  const source = node(page, 'Update debt status to Written Off').locator('.react-flow__handle-bottom.source');
  const target = node(page, 'Notify debtor').locator('.react-flow__handle-top.target');
  await source.hover();
  await page.mouse.down();
  await target.hover();
  await page.mouse.up();
  await expect(page.getByText('"Notify debtor" is not connected to the process.')).toBeHidden();
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);

  // Undo and redo the connection.
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);

  // Accept a finding.
  await page.getByRole('tab', { name: /Findings/ }).click();
  await page.getByRole('button', { name: 'Accept' }).first().click();
  await expect(page.getByText('Reviewed (1)')).toBeVisible();

  // Unsaved work is protected when navigating away.
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay' }).click();

  // 8. Save. The database assigns reference codes.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(node(page, 'Retrieve debt record from ledger')).toContainText(/ACT-\d{3}/);

  // 9. Reopen later: everything is persisted.
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await expect(node(page, 'Retrieve debt record from ledger')).toBeVisible();
  await expect(node(page, 'Outstanding more than 5 years?')).toContainText('Supervisor');
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);
  await page.locator('.react-flow__edge', { hasText: 'Rejected' }).locator('.react-flow__edge-textbg').click();
  await expect(page.getByLabel('Condition')).toHaveValue('Supervisor rejects the write-off');
  await page.getByRole('tab', { name: /Findings/ }).click();
  await expect(page.getByText('Reviewed (1)')).toBeVisible();

  // The process list shows the saved draft.
  await page.getByRole('link', { name: 'Back to processes' }).click();
  await expect(page.getByRole('row', { name: /PRC-001 Debt write-off To-Be/ })).toContainText('Draft');
  await page.getByRole('link', { name: 'Debt write-off' }).click();

  // Approval acknowledges warnings and freezes the version.
  await page.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog', { name: 'Approve version 1' });
  await expect(approve.getByRole('button', { name: 'Approve version' })).toBeDisabled();
  await approve.getByLabel(/I have reviewed these warnings/).check();
  await approve.getByRole('button', { name: 'Approve version' }).click();
  await expect(approve).toBeHidden();
  await expect(page.getByText('Version 1 is approved. It cannot be changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // Changing an approved process starts a new draft version; v1 is preserved.
  await page.getByRole('button', { name: 'Create new draft' }).click();
  await expect(page.getByLabel('Version')).toHaveValue(/.+/);
  await expect(page.getByLabel('Version').locator('option')).toHaveCount(2);
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await node(page, 'Notify debtor').click();
  await page.getByLabel('Name').fill('Notify debtor by letter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  const v1 = await page.getByLabel('Version').locator('option', { hasText: 'Version 1 · Approved' }).getAttribute('value');
  await page.getByLabel('Version').selectOption(v1!);
  await expect(node(page, 'Notify debtor')).toBeVisible();
  await expect(node(page, 'Notify debtor by letter')).toHaveCount(0);
});

test('a read-only member cannot edit or analyse', async ({ browser }) => {
  // The admin creates a project and adds a developer.
  const adminPage = await browser.newPage();
  await signUp(adminPage, 'Dana Admin', `dana-${unique}@example.com`);
  await adminPage.getByRole('button', { name: 'Create your first project' }).click();
  await adminPage.getByLabel('Project name').fill('Access Control');
  await adminPage.getByLabel('Project key').fill(`A${unique}`);
  await adminPage.getByRole('button', { name: 'Create project' }).click();
  await adminPage.getByRole('button', { name: 'Create a process' }).click();
  await adminPage.getByLabel('Process name').fill('Refund approval');
  await adminPage.getByRole('button', { name: 'Create and open designer' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Refund approval' })).toBeVisible();

  const devPage = await browser.newPage();
  await signUp(devPage, 'Devin Developer', `devin-${unique}@example.com`);
  await expect(devPage.getByText('No projects yet')).toBeVisible();

  await adminPage.goto('/projects');
  await adminPage.getByRole('link', { name: 'Members' }).click();
  await adminPage.getByLabel('Email of a registered user').fill(`devin-${unique}@example.com`);
  await adminPage.getByLabel('Role', { exact: true }).selectOption('developer');
  await adminPage.getByRole('button', { name: 'Add member' }).click();
  await expect(adminPage.getByText('Devin Developer')).toBeVisible();

  await devPage.reload();
  await devPage.getByRole('link', { name: 'Open processes' }).click();
  await expect(devPage.getByRole('button', { name: 'New process' })).toHaveCount(0);
  await devPage.getByRole('link', { name: 'Refund approval' }).click();
  await expect(devPage.getByText('You have read-only access as Developer.')).toBeVisible();
  await expect(devPage.getByRole('button', { name: 'Analyse & Generate Process Map' })).toHaveCount(0);
  await expect(devPage.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(devPage.getByRole('button', { name: 'Activity', exact: true })).toHaveCount(0);
});
