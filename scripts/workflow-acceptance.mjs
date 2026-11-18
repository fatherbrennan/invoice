import assert from 'node:assert/strict';
import { chooseOption } from './combobox-acceptance.mjs';

export async function verifyInvoiceWorkflow({
  page,
  route,
  ipc,
  fixture,
  viewport,
  shot,
  checks,
}) {
  await ipc('save_profile', { profile: fixture.profile });
  await viewport({ width: 1280, height: 850 });
  await route('Invoices');
  await page.getByRole('link', { name: 'New draft', exact: true }).click();
  await page
    .getByRole('button', { name: 'Issue invoice', exact: true })
    .click();
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Customer', exact: true })
      .getAttribute('aria-invalid'),
    'true',
  );
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Unfinished workflow review');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete draft', exact: true })
    .waitFor();
  const partialId = new URL(page.url()).searchParams.get('id');
  assert(partialId);
  await page.reload();
  assert.equal(
    await page.getByLabel('Notes', { exact: true }).inputValue(),
    'Unfinished workflow review',
  );
  await page.getByRole('button', { name: 'Delete draft', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete this draft?' })
    .getByRole('button', { name: 'Delete draft permanently', exact: true })
    .click();
  await page.getByLabel('Search invoices', { exact: true }).waitFor();
  await assert.rejects(() => ipc('get_draft', { id: partialId }));

  await page.getByRole('link', { name: 'New draft', exact: true }).click();
  const customer = page.getByRole('combobox', {
    name: 'Customer',
    exact: true,
  });
  await customer.fill('Workflow buyer');
  await page
    .getByRole('button', { name: 'Create customer…', exact: true })
    .click();
  const customerDialog = page.getByRole('dialog', {
    name: 'Create customer',
    exact: true,
  });
  await customerDialog
    .getByLabel('Customer name', { exact: true })
    .fill('Workflow buyer');
  await customerDialog.getByLabel('Customer code', { exact: true }).fill('WFR');
  await customerDialog
    .getByRole('button', { name: 'Create customer and select' })
    .click();
  await customerDialog.waitFor({ state: 'hidden' });
  assert.equal(await customer.inputValue(), 'Workflow buyer (WFR)');
  const base = {
    id: 'workflow-base',
    name: 'Workflow service',
    description: 'Original work',
    unitPrice: '100.00',
    tax: 'taxable',
  };
  await ipc('save_service', { service: base });
  await page
    .getByRole('combobox', { name: 'Service 1', exact: true })
    .fill(base.name);
  await page.getByRole('option', { name: /Workflow service/ }).click();
  await page
    .getByRole('button', { name: 'Adapt service 1', exact: true })
    .click();
  const serviceDialog = page.getByRole('dialog', {
    name: 'Adapt service',
    exact: true,
  });
  await serviceDialog
    .getByLabel('Service name', { exact: true })
    .fill('Workflow custom service');
  await serviceDialog
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('175.00');
  await serviceDialog
    .getByLabel('Invoice description', { exact: true })
    .fill('Adapted work saved for reuse');
  await serviceDialog
    .getByRole('button', { name: 'Save variation and select' })
    .click();
  await serviceDialog.waitFor({ state: 'hidden' });
  const services = (
    await ipc('search_services', { query: { query: 'Workflow', page: 0 } })
  ).items;
  assert.equal(services.find((s) => s.id === base.id).unitPrice, '100.00');
  assert.equal(
    services.find((s) => s.name === 'Workflow custom service').unitPrice,
    '175.00',
  );
  await page.getByLabel('Invoice date', { exact: true }).fill('2026-01-01');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="draft-total"]')?.textContent ===
      '$192.50',
  );
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await page.getByLabel('Quantity 1', { exact: true }).fill('2');
  assert.equal(
    await page.locator('[data-testid="draft-total"]').textContent(),
    '$192.50',
  );
  assert.equal(await page.locator('canvas[data-rendered="true"]').count(), 1);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="draft-total"]')?.textContent ===
      '$385.00',
  );
  await viewport({ width: 760, height: 600 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  assert(
    (await page.locator('canvas[data-rendered="true"]').boundingBox()).width >
      500,
  );
  await shot('workflow-draft-preview-760');
  await page.getByRole('button', { name: 'Edit invoice', exact: true }).click();
  await viewport({ width: 1280, height: 850 });
  await shot('workflow-draft-desktop');
  await page
    .getByRole('button', { name: 'Issue invoice', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm issue', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Preview IWFR1', exact: true })
    .waitFor();
  const issuedId = new URL(page.url()).searchParams.get('id');
  const original = await ipc('read_pdf', { id: issuedId });
  await page.getByLabel('Search invoices', { exact: true }).fill('Workflow');
  await chooseOption(
    page.getByRole('combobox', { name: 'Invoice status', exact: true }),
    'Overdue now',
  );
  await page
    .getByRole('button', { name: 'Preview IWFR1', exact: true })
    .click();
  assert(
    (await page.locator('.ledger tbody').textContent()).includes(
      'days overdue',
    ),
  );
  await route('Services');
  await route('Invoices');
  assert.equal(
    await page.getByLabel('Search invoices', { exact: true }).inputValue(),
    'Workflow',
  );
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Invoice status', exact: true })
      .inputValue(),
    'Overdue now',
  );
  await page.getByRole('heading', { name: 'IWFR1', exact: true }).waitFor();
  await page
    .locator('.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]')
    .waitFor();
  await page
    .getByRole('button', { name: 'Preview IWFR1', exact: true })
    .waitFor();
  await shot('workflow-ledger-overdue');
  await page
    .getByRole('button', { name: 'Correct invoice', exact: true })
    .click();
  await page
    .getByLabel('Reason for correction', { exact: true })
    .fill('Wrong quantity');
  await page
    .getByRole('button', { name: 'Void and create replacement', exact: true })
    .click();
  await page.getByLabel('Quantity 1', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Quantity 1', { exact: true }).inputValue(),
    '2',
  );
  assert.equal(
    (await ipc('get_issued', { id: issuedId })).voidReason,
    'Wrong quantity',
  );
  assert.deepEqual(await ipc('read_pdf', { id: issuedId }), original);
  const replacement = await ipc('get_draft', {
    id: new URL(page.url()).searchParams.get('id'),
  });
  for (let i = 0; i < 52; i++)
    await ipc('save_draft', {
      draft: { ...replacement, id: `paging-${i}`, notes: 'Workflow paging' },
    });
  await page.goto(new URL('/invoices', page.url()).href);
  await page
    .getByLabel('Search invoices', { exact: true })
    .fill('Workflow paging');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page
    .locator('.pagination [role="status"]')
    .filter({ hasText: '26' })
    .waitFor();
  const table = page.getByRole('region', {
    name: 'Invoices table',
    exact: true,
  });
  await table.evaluate((node) => (node.scrollTop = 150));
  const offset = await table.evaluate((node) => node.scrollTop);
  assert(offset > 0);
  await route('Services');
  await route('Invoices');
  await page
    .locator('.pagination [role="status"]')
    .filter({ hasText: '26' })
    .waitFor();
  await page.waitForFunction(
    (value) =>
      document.querySelector('.ledger .table-scroll')?.scrollTop === value,
    offset,
  );
  for (let i = 0; i < 52; i++) await ipc('delete_draft', { id: `paging-${i}` });
  await page.goto(new URL('/invoices', page.url()).href);

  await route('Services');
  await page
    .getByLabel('Search services', { exact: true })
    .fill('Workflow custom');
  await page
    .getByRole('button', { name: 'Edit Workflow custom service', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Edit Workflow custom service', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Remove service', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm removal', exact: true })
    .click();
  assert.equal(
    (
      await ipc('search_services', {
        query: { query: 'Workflow custom', page: 0 },
      })
    ).total,
    0,
  );
  assert.equal(
    (await ipc('get_draft', { id: replacement.id })).lines[0].unitPrice,
    '175.00',
  );
  checks.push(
    'Workflow: incomplete draft save/reload/delete, field validation, inline customer, persistent service variation, stable preview, narrow preview, overdue/search/page/scroll restoration, service deletion and immutable correction verified in native SQLite/WebView2.',
  );
}
