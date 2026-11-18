import assert from 'node:assert/strict';
import { reportingToday, resolvePeriod } from '../src/lib/invoice-period.ts';
import { chooseOption } from './combobox-acceptance.mjs';

export async function verifyInvoiceSummary({
  page,
  route,
  ipc,
  fixture,
  checks,
  shot,
  viewport,
}) {
  await viewport({ width: 1280, height: 850 });
  await ipc('save_profile', { profile: fixture.profile });
  const customer = {
    ...fixture.customer,
    id: 'report-customer',
    code: 'REP',
    nextNumber: 1,
  };
  await ipc('save_customer', { customer });
  const services = [];
  for (const [tax, unitPrice] of [
    ['taxable', '0.05'],
    ['gstFree', '20'],
    ['inputTaxed', '30'],
    ['noGst', '40'],
  ]) {
    const service = {
      id: `report-${tax}`,
      name: `Reporting ${tax}`,
      description: `Reporting ${tax}`,
      unitPrice,
      tax,
    };
    await ipc('save_service', { service });
    services.push(service);
  }
  const line = (service) => ({
    service: { id: service.id, name: service.name },
    description: service.description,
    quantity: '1',
    unitPrice: service.unitPrice,
    tax: service.tax,
  });
  async function issue(
    n,
    date,
    lines,
    paid = false,
    due = { mode: 'exact', date: '2020-01-20' },
  ) {
    const draft = {
      id: `report-native-${n}`,
      customerId: customer.id,
      date,
      notes: 'Summary acceptance',
      due,
      lines,
    };
    await ipc('save_draft', { draft });
    await ipc('issue', { id: draft.id });
    if (paid) await ipc('set_paid', { id: draft.id, paid });
  }
  for (let n = 1; n <= 26; n++)
    await issue(
      n,
      n <= 13 ? '2020-01-01' : '2020-01-31',
      [line(services[0]), line(services[0])],
      n % 2 === 0,
    );
  await issue(27, '2020-01-15', services.slice(0, 3).map(line));
  await issue(29, '2019-12-31', [line(services[0]), line(services[0])]);
  await issue(30, '2020-02-01', [line(services[0]), line(services[0])]);
  await ipc('save_profile', {
    profile: { ...fixture.profile, gstRegistered: false },
  });
  await issue(28, '2020-01-15', [line(services[3])], false, { mode: 'none' });
  await ipc('save_profile', { profile: fixture.profile });
  const range = { from: '2020-01-01', to: '2020-01-31' };
  const result = await ipc('invoice_summary', {
    range,
    today: reportingToday(),
  });
  assert.deepEqual(result.all, { count: 28, net: 9265, gst: 53, total: 9318 });
  assert.deepEqual(result.paid, { count: 13, net: 130, gst: 26, total: 156 });
  assert.equal(result.overdue.total, 5162);
  assert.equal(result.noDueDate.total, 4000);
  await route('Invoices');
  const sections = () =>
    page.getByRole('navigation', { name: 'Invoice sections' });
  await sections().getByRole('link', { name: 'Summary', exact: true }).click();
  const payments = () =>
    page.getByRole('region', { name: 'Payment status totals', exact: true });
  await payments().waitFor();
  await chooseOption(
    page.getByRole('combobox', { name: 'Invoice date', exact: true }),
    'Last month',
  );
  const last = resolvePeriod('lastMonth', reportingToday());
  assert.equal(
    await page.locator('.period-range').textContent(),
    `${last.from} to ${last.to}`,
  );
  await chooseOption(
    page.getByRole('combobox', { name: 'Invoice date', exact: true }),
    'Custom',
  );
  await page.getByLabel('From (inclusive)', { exact: true }).fill(range.from);
  await page.getByLabel('To (inclusive)', { exact: true }).fill(range.to);
  await page.waitForFunction(
    () => document.querySelector('.metrics dd')?.textContent === '28',
  );
  assert.deepEqual(await page.locator('.metrics dd').allTextContents(), [
    '28',
    '$92.65',
    '$0.53',
    '$93.18',
  ]);
  assert.equal(
    await page
      .getByRole('combobox', { name: 'Invoice date', exact: true })
      .inputValue(),
    'Custom',
  );
  assert.deepEqual(
    await page
      .getByRole('region', { name: 'GST category totals' })
      .locator('tbody tr')
      .allTextContents(),
    [
      'Taxable (10% GST)$2.65$0.53$3.18',
      'GST-free$20.00$0.00$20.00',
      'Input taxed$30.00$0.00$30.00',
      'No GST$40.00$0.00$40.00',
    ],
  );
  await shot('invoice-summary');
  await payments()
    .getByRole('link', { name: 'All issued', exact: true })
    .click();
  const ledger = () =>
    page.getByRole('region', { name: 'Invoices table', exact: true });
  await page.getByRole('status').filter({ hasText: 'of 28' }).waitFor();
  assert.equal(await ledger().locator('tbody tr').count(), 25);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Invoices table"] tbody')?.children
        .length === 3,
  );
  await sections().getByRole('link', { name: 'Summary', exact: true }).click();
  await payments()
    .getByRole('link', { name: 'Marked paid', exact: true })
    .click();
  await page.getByRole('status').filter({ hasText: 'of 13' }).waitFor();
  await ledger()
    .getByRole('button', { name: /Preview IREP/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Mark IREP\d+ unpaid/ }).click();
  await page.getByRole('status').filter({ hasText: 'of 12' }).waitFor();
  await sections().getByRole('link', { name: 'Summary', exact: true }).click();
  await payments().waitFor();
  assert.match(
    await payments().locator('tbody tr').nth(1).textContent(),
    /Marked paid12\$1.20\$0.24\$1.44/,
  );
  await payments()
    .getByRole('link', { name: 'Unpaid · no due date', exact: true })
    .click();
  await page.getByRole('status').filter({ hasText: 'of 1' }).waitFor();
  assert.equal(await ledger().locator('tbody tr').count(), 1);
  await sections().getByRole('link', { name: 'Summary', exact: true }).click();
  await payments().waitFor();
  await page.getByLabel('To (inclusive)', { exact: true }).fill('2019-01-01');
  await page
    .getByText('To date must be on or after From date.', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.metrics').count(), 0);
  await page.getByLabel('From (inclusive)', { exact: true }).fill('2018-01-01');
  await page.getByLabel('To (inclusive)', { exact: true }).fill('2018-01-31');
  await page
    .getByText('No issued invoices in this period.', { exact: true })
    .waitFor();
  assert.deepEqual(await page.locator('.metrics dd').allTextContents(), [
    '0',
    '$0.00',
    '$0.00',
    '$0.00',
  ]);
  await page.evaluate(() => {
    window.summaryOriginalFetch = window.fetch;
    window.fetch = (input, ...args) =>
      String(input) ===
      window.__TAURI_INTERNALS__.convertFileSrc('invoice_summary', 'ipc')
        ? Promise.resolve(
            new Response(JSON.stringify('Synthetic summary read failure'), {
              status: 400,
              headers: {
                'content-type': 'application/json',
                'Tauri-Response': 'error',
              },
            }),
          )
        : window.summaryOriginalFetch(input, ...args);
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Synthetic summary read failure' })
    .waitFor();
  assert.equal(await page.locator('.metrics').count(), 0);
  await page.evaluate(() => {
    window.fetch = window.summaryOriginalFetch;
    delete window.summaryOriginalFetch;
  });
  await page
    .getByRole('button', { name: 'Retry summary', exact: true })
    .click();
  await page
    .getByText('No issued invoices in this period.', { exact: true })
    .waitFor();
  await page.getByLabel('From (inclusive)', { exact: true }).fill(range.from);
  await page.getByLabel('To (inclusive)', { exact: true }).fill(range.to);
  await payments().waitFor();
  for (const [width, height] of [
    [760, 600],
    [390, 600],
    [1280, 850],
  ]) {
    await viewport({ width, height });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight,
      ),
    );
    const region = page.getByRole('region', {
      name: 'Invoice summary',
      exact: true,
    });
    await region.focus();
    await region.press('End');
    await page
      .getByRole('heading', { name: 'GST breakdown', exact: true })
      .scrollIntoViewIfNeeded();
    if (width === 760) await shot('invoice-summary-compact');
  }
  // A running report advances at Adelaide midnight, even if it stays open overnight.
  await page.clock.install({ time: new Date('2026-11-15T13:28:00Z') });
  // Reload so app timers are registered under the controlled clock, before pausing it.
  await page.goto(new URL('/invoices/summary?period=last7', page.url()).href);
  await payments().waitFor();
  await page.clock.pauseAt(new Date('2026-11-15T13:29:59Z'));
  assert(
    (await page.locator('.period-range').textContent()).endsWith('2026-11-15'),
  );
  await page.clock.runFor(1100);
  await page.waitForFunction(
    () =>
      document.querySelector('.period-range')?.textContent ===
      '2026-11-10 to 2026-11-16',
  );
  await page.clock.resume();
  await page.clock.setSystemTime(new Date());
  for (const service of services)
    await ipc('delete_service', { id: service.id });
  checks.push(
    'Invoice summary: real issued snapshots, all tax categories, 28-row pagination, date/status drill-through, payment refresh, invalid/empty/error states, narrow layouts and Adelaide midnight rollover',
  );
}
