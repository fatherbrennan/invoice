import assert from 'node:assert/strict';
import { chooseOption } from './combobox-acceptance.mjs';

// The consolidated toolbar must retain every status, combined filters and keyboard access.
export async function verifyLedgerFilters({
  page,
  route,
  ipc,
  fixture,
  viewport,
  shot,
  checks,
}) {
  await ipc('save_profile', { profile: fixture.profile });
  await ipc('save_customer', {
    customer: { ...fixture.customer, id: 'filter-customer', code: 'FLT' },
  });
  const service = {
    id: 'filter-service',
    name: 'Filter review service',
    description: 'Filter review',
    unitPrice: '100.00',
    tax: 'taxable',
  };
  await ipc('save_service', { service });
  const draft = {
    ...fixture.draft,
    customerId: 'filter-customer',
    notes: 'Filter review',
    lines: [
      {
        service: { id: service.id, name: service.name },
        description: service.description,
        unitPrice: service.unitPrice,
        tax: service.tax,
        quantity: '1',
      },
    ],
  };
  for (const [id, date, due] of [
    ['overdue', '2010-01-10', { mode: 'exact', date: '2010-01-15' }],
    ['paid', '2010-01-20', { mode: 'exact', date: '2010-01-25' }],
    ['future', '2010-02-01', { mode: 'exact', date: '9999-12-31' }],
    ['no-date', '2010-01-31', { mode: 'none' }],
    ['void', '2010-01-15', { mode: 'none' }],
  ]) {
    await ipc('save_draft', {
      draft: {
        ...draft,
        id: `filter-${id}`,
        date,
        due,
        notes: id === 'overdue' ? 'Filter review needle' : draft.notes,
      },
    });
    await ipc('issue', { id: `filter-${id}` });
  }
  await ipc('set_paid', { id: 'filter-paid', paid: true });
  await ipc('correct_invoice', {
    id: 'filter-void',
    newId: 'filter-replacement',
    reason: 'Filter review correction',
  });
  await ipc('delete_draft', { id: 'filter-replacement' });
  await ipc('save_draft', {
    draft: {
      ...draft,
      id: 'filter-draft',
      date: '2010-01-12',
      due: { mode: 'none' },
    },
  });
  await page.goto(new URL('/invoices', page.url()).href);
  await viewport({ width: 1280, height: 850 });
  const search = page.getByLabel('Search invoices', { exact: true });
  const status = page.getByRole('combobox', {
    name: 'Invoice status',
    exact: true,
  });
  const period = page.getByRole('combobox', {
    name: 'Invoice date',
    exact: true,
  });
  const ledger = page.getByRole('region', {
    name: 'Invoice ledger',
    exact: true,
  });
  async function count(expected) {
    await page.waitForFunction((expected) => {
      const ledger = document.querySelector('[aria-label="Invoice ledger"]');
      return (
        ledger?.getAttribute('aria-busy') === 'false' &&
        ledger.querySelectorAll('tbody tr').length === expected
      );
    }, expected);
    assert.equal(await ledger.locator('tbody tr').count(), expected);
  }
  await search.fill('Filter review');
  await count(6);
  for (const [label, expected] of [
    ['Drafts', ['Draft']],
    ['Issued', ['IFLT3', 'IFLT4', 'IFLT2', 'IFLT1']],
    ['Unpaid', ['IFLT3', 'IFLT4', 'IFLT1']],
    ['Paid', ['IFLT2']],
    ['Overdue now', ['IFLT1']],
    ['Voided', ['IFLT5']],
    ['Unpaid · no due date', ['IFLT4']],
    ['All statuses', ['IFLT3', 'IFLT4', 'IFLT2', 'IFLT5', 'Draft', 'IFLT1']],
  ]) {
    await chooseOption(status, label);
    await page.waitForFunction((expected) => {
      const ledger = document.querySelector('[aria-label="Invoice ledger"]');
      return (
        ledger?.getAttribute('aria-busy') === 'false' &&
        [...ledger.querySelectorAll('tbody th')]
          .map((node) => node.textContent.trim())
          .join('|') === expected.join('|')
      );
    }, expected);
    assert.deepEqual(
      (await ledger.locator('tbody th').allTextContents()).map((text) =>
        text.trim(),
      ),
      expected,
    );
    assert.equal(await status.inputValue(), label);
  }
  await chooseOption(period, 'Custom');
  await page.getByLabel('From (inclusive)', { exact: true }).fill('2010-01-01');
  await page.getByLabel('To (inclusive)', { exact: true }).fill('2010-01-31');
  await count(5);
  await chooseOption(status, 'Unpaid');
  await count(2);
  await search.fill('Filter review needle');
  await count(1);
  await route('Services');
  await route('Invoices');
  await count(1);
  assert.equal(await search.inputValue(), 'Filter review needle');
  assert.equal(await status.inputValue(), 'Unpaid');
  assert.equal(await period.inputValue(), 'Custom');
  assert.equal(
    await page.getByLabel('From (inclusive)', { exact: true }).inputValue(),
    '2010-01-01',
  );
  assert.equal(
    await page.getByLabel('To (inclusive)', { exact: true }).inputValue(),
    '2010-01-31',
  );
  await search.fill('Filter review');
  await page.getByLabel('From (inclusive)', { exact: true }).fill('2010-01-31');
  await count(1);
  assert.match(await ledger.locator('tbody').textContent(), /IFLT4/);
  await page.getByLabel('From (inclusive)', { exact: true }).fill('2010-02-01');
  await page
    .getByText('To date must be on or after From date.', { exact: true })
    .waitFor();
  await count(0);
  assert(
    await page
      .getByRole('button', { name: 'Refresh', exact: true })
      .isDisabled(),
  );
  await chooseOption(period, 'All time');
  await chooseOption(status, 'All statuses');
  await count(6);
  await search.fill('no-matching-filter-review');
  await page
    .getByRole('heading', { name: 'No matching invoices', exact: true })
    .waitFor();
  await search.fill('Filter review');
  await count(6);
  await page
    .getByRole('button', { name: 'Preview IFLT1', exact: true })
    .press('Enter');
  await page.getByRole('heading', { name: 'IFLT1', exact: true }).waitFor();
  await page.keyboard.press('Control+f');
  assert(await search.evaluate((node) => node === document.activeElement));
  await page.keyboard.press('Tab');
  assert(await status.evaluate((node) => node === document.activeElement));
  // Fixed-choice fields open on focus; close the list before leaving the field.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert(await period.evaluate((node) => node === document.activeElement));

  // Search, status and date should share the first toolbar row even with details open.
  const positions = await Promise.all(
    [search, status, period].map((control) => control.boundingBox()),
  );
  assert(
    positions.every((box) => Math.abs(box.y - positions[0].y) < 2),
    'Search, status and invoice date share one toolbar row at 1280px',
  );
  for (const width of [1280, 760, 380]) {
    await viewport({ width, height: 850 });
    for (const dateChoice of ['All time', 'Last month', 'Custom']) {
      await chooseOption(period, dateChoice);
      if (dateChoice === 'Custom') {
        await page
          .getByLabel('From (inclusive)', { exact: true })
          .fill('2010-01-01');
        await page
          .getByLabel('To (inclusive)', { exact: true })
          .fill('2010-01-31');
      }
      await count(
        dateChoice === 'All time' ? 6 : dateChoice === 'Custom' ? 5 : 0,
      );
      if (width === 1280 && dateChoice === 'Custom') {
        await page
          .getByRole('button', { name: 'Preview IFLT1', exact: true })
          .press('Enter');
        await page
          .getByRole('heading', { name: 'IFLT1', exact: true })
          .waitFor();
        const from = await page
          .getByLabel('From (inclusive)', { exact: true })
          .boundingBox();
        const to = await page
          .getByLabel('To (inclusive)', { exact: true })
          .boundingBox();
        assert(
          Math.abs(from.y - to.y) < 2,
          'Custom range fields stay together when invoice details are open',
        );
        await page
          .locator(
            '.pdf-preview[aria-busy="false"] canvas[data-rendered="true"]',
          )
          .waitFor();
      }
      const bounds = await ledger.boundingBox();
      for (const control of [
        search,
        status,
        period,
        page.getByRole('button', { name: 'Refresh', exact: true }),
      ]) {
        const box = await control.boundingBox();
        assert(
          box &&
            box.x >= bounds.x &&
            box.x + box.width <= bounds.x + bounds.width + 1,
          `${width}px ${dateChoice}: filter stays inside the ledger`,
        );
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await shot(
        `ledger-filters-${width}-${dateChoice.replace(' ', '-').toLowerCase()}`,
      );
    }
  }
  await viewport({ width: 1280, height: 850 });
  await page.goto(new URL('/invoices', page.url()).href);
  checks.push(
    'Ledger: all eight statuses, combined search/date/status, inclusive date bounds, invalid range, empty results, navigation restoration, keyboard filter order and responsive toolbar verified.',
  );
}
