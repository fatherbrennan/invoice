import assert from 'node:assert/strict';

export async function verifyRowNavigation({
  page,
  route,
  ipc,
  fixture,
  checks,
  viewport,
  shot,
  fail,
}) {
  await viewport({ width: 1280, height: 600 });
  await ipc('save_profile', { profile: fixture.profile });
  const service = {
    id: 'row-service-01',
    name: 'Row navigation 01',
    description: 'Navigation fixture',
    unitPrice: '1.00',
    tax: 'taxable',
  };
  for (let n = 1; n <= 26; n++) {
    const suffix = String(n).padStart(2, '0');
    await ipc('save_customer', {
      customer: {
        ...fixture.customer,
        id: `row-customer-${suffix}`,
        code: `RN${String.fromCharCode(64 + n)}`,
        name: `Row navigation ${suffix}`,
      },
    });
    await ipc('save_service', {
      service: {
        ...service,
        id: `row-service-${suffix}`,
        name: `Row navigation ${suffix}`,
      },
    });
    const draft = {
      ...fixture.draft,
      id: `row-draft-${suffix}`,
      customerId: 'row-customer-01',
      notes: 'Row navigation',
      lines: [
        {
          service: { id: service.id, name: service.name },
          description: service.description,
          quantity: '1',
          unitPrice: '1.00',
          tax: 'taxable',
        },
      ],
    };
    await ipc('save_draft', { draft });
    if (n <= 2) await ipc('issue', { id: draft.id });
  }
  const focused = async (control) => {
    await control.and(page.locator(':focus')).waitFor();
    assert(
      await control.evaluate((node) => node === document.activeElement),
      'Expected keyboard focus on the requested row/control',
    );
  };
  const table = () => page.locator('.table-scroll table');
  const rows = () => table().locator('tbody tr');
  const control = (index) => rows().nth(index).locator('button, a').first();
  const ready = async () =>
    page.locator('[data-shortcut-context="list"][aria-busy="false"]').waitFor();
  // Delay real native responses to prove the newest selection wins.
  async function holdResponses(commands, id) {
    await page.evaluate(
      ({ commands, id }) => {
        window.rowOriginalFetch = window.fetch;
        window.rowResponses = [];
        const urls = commands.map((command) =>
          window.__TAURI_INTERNALS__.convertFileSrc(command, 'ipc'),
        );
        window.fetch = (input, options) => {
          const response = window.rowOriginalFetch(input, options);
          if (
            urls.includes(String(input)) &&
            JSON.parse(options.body).id === id
          ) {
            return new Promise((resolve, reject) =>
              window.rowResponses.push(() => response.then(resolve, reject)),
            );
          }
          return response;
        };
      },
      { commands, id },
    );
  }
  async function releaseResponses() {
    await page.evaluate(async () => {
      window.fetch = window.rowOriginalFetch;
      await Promise.all(window.rowResponses.map((release) => release()));
      delete window.rowOriginalFetch;
      delete window.rowResponses;
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }

  for (const name of ['Customers', 'Services', 'Invoices']) {
    await route(name);
    const search = page.getByLabel(`Search ${name.toLowerCase()}`, {
      exact: true,
    });
    await search.fill('Row navigation');
    await ready();
    assert.equal(await rows().count(), 25);
    await rows().nth(0).locator('td').last().click();
    await page.keyboard.press('ArrowDown');
    await focused(control(1));
    await page.keyboard.press('ArrowDown');
    await focused(control(2));
    await page.keyboard.press('ArrowUp');
    await focused(control(1));
    assert.equal(
      await page.locator('tbody tr.selected').count(),
      1,
      'Navigation selects the active record on all three lists',
    );
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowDown');
    await page.keyboard.up('ArrowDown');
    await focused(control(3));
    await page.keyboard.press('Shift+ArrowDown');
    await focused(control(3));
    await control(0).focus();
    await page.keyboard.press('ArrowUp');
    await focused(control(0));
    for (let n = 0; n < 25; n++) await page.keyboard.press('ArrowDown');
    await focused(control(24));
    assert.equal(
      await rows().count(),
      25,
      'Arrow at page boundary must not paginate',
    );
    assert(
      await control(24).evaluate((node) => {
        const row = node.closest('tr').getBoundingClientRect();
        const bounds = node.closest('.table-scroll').getBoundingClientRect();
        return row.bottom <= bounds.bottom + 1 && row.top >= bounds.top;
      }),
      'Focused row must scroll into view',
    );
    assert.equal(
      await rows()
        .nth(24)
        .evaluate((node) => getComputedStyle(node).outlineStyle),
      'solid',
      'Keyboard focus must outline the row',
    );
    for (let n = 0; n < 24; n++) await page.keyboard.press('ArrowUp');
    await focused(control(0));
    assert(
      await control(0).evaluate(
        (node) =>
          node.closest('tr').getBoundingClientRect().top >=
          node.closest('table').querySelector('thead').getBoundingClientRect()
            .bottom -
            1,
      ),
      'Upward scrolling must keep the focused row below the sticky heading',
    );
    await control(24).focus();
    await page.keyboard.press('Tab');
    assert(
      !(await table().evaluate((node) =>
        node.contains(document.activeElement),
      )),
      'Tab must leave the last row',
    );
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await ready();
    assert.equal(await rows().count(), 1);
    await control(0).focus();
    await page.keyboard.press('ArrowDown');
    await focused(control(0));
    await search.fill('Row navigation 01');
    await ready();
    await focused(search);
    await search.press('ArrowDown');
    await focused(search);
    await search.fill('no-navigation-match');
    await ready();
    assert.equal(await rows().count(), 0);
    await focused(search);
    await search.fill('Row navigation');
    await ready();

    if (name !== 'Invoices') {
      // Change the query and re-enter the old results before the debounced response.
      async function filterFromRow(query, rowIndex) {
        await search.evaluate(
          (input, { query, rowIndex }) => {
            input.value = query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            document
              .querySelectorAll('.table-scroll tbody tr')
              [rowIndex].querySelector('button')
              .focus();
          },
          { query, rowIndex },
        );
        await page
          .locator('[data-shortcut-context="list"][aria-busy="true"]')
          .waitFor();
        await page.keyboard.press('ArrowDown');
        await focused(control(rowIndex));
        await ready();
      }
      await filterFromRow('Row navigation 25', 24);
      await focused(control(0));
      assert.equal(
        await control(0).textContent(),
        'Row navigation 25',
        'Filtering retains focus by record identity',
      );
      await filterFromRow('Row navigation 26', 0);
      await focused(control(0));
      assert.equal(
        await control(0).textContent(),
        'Row navigation 26',
        'Removed focused row falls back to an available row',
      );
      await filterFromRow('no-navigation-match', 0);
      await focused(search);
      assert.equal(await rows().count(), 0);
      await search.fill('Row navigation');
      await ready();
      const fieldId = name === 'Customers' ? 'customer-name' : 'service-name';
      const field = page.locator(`#${fieldId}`);
      async function details(value) {
        await page.waitForFunction(
          ({ id, value }) => {
            const input = document.getElementById(id);
            return (
              input?.value === value && !input.closest('fieldset').disabled
            );
          },
          { id: fieldId, value },
        );
      }
      await control(0).click();
      await details('Row navigation 01');
      await focused(control(0));
      await page.keyboard.press('ArrowDown');
      await details('Row navigation 02');
      await focused(control(1));
      assert(
        await page
          .getByRole('button', {
            name: name === 'Customers' ? 'Save customer' : 'Save service',
            exact: true,
          })
          .isDisabled(),
        'Browsing does not create unsaved edits',
      );
      await page.keyboard.press('Enter');
      await focused(field);
      await field.fill('Unsaved navigation edit');
      await field.press('ArrowDown');
      await focused(field);
      await control(1).click();
      await focused(control(1));
      assert.equal(
        await page.getByRole('dialog').count(),
        0,
        'Selecting the current record preserves its edits without prompting',
      );
      assert.equal(await field.inputValue(), 'Unsaved navigation edit');
      await page.keyboard.press('ArrowUp');
      const dialog = page.getByRole('dialog', {
        name: `Unsaved ${name === 'Customers' ? 'customer' : 'service'} changes`,
      });
      await dialog.waitFor();
      await page.keyboard.press('ArrowDown');
      assert(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
        'Arrows must stay in the confirmation',
      );
      await page.keyboard.press('Escape');
      await focused(control(1));
      assert.equal(await field.inputValue(), 'Unsaved navigation edit');
      assert(
        await rows()
          .nth(1)
          .evaluate((node) => node.classList.contains('selected')),
        'Cancelled switching retains the current record',
      );
      await page.keyboard.press('ArrowUp');
      await dialog
        .getByRole('button', { name: 'Discard changes', exact: true })
        .click();
      await details('Row navigation 01');
      await focused(control(0));
      await field.fill('Unsaved mouse selection');
      await control(1).click();
      await dialog
        .getByRole('button', { name: 'Keep editing', exact: true })
        .click();
      await focused(control(0));
      assert.equal(await field.inputValue(), 'Unsaved mouse selection');
      await control(1).click();
      await dialog
        .getByRole('button', { name: 'Discard changes', exact: true })
        .click();
      await details('Row navigation 02');
      await focused(control(1));
      await page.keyboard.press('Enter');
      await focused(field);
      assert.equal(await field.inputValue(), 'Row navigation 02');
      if (name === 'Customers') {
        await holdResponses(['get_customer'], 'row-customer-01');
        try {
          await control(0).click();
          await page.waitForFunction(() => window.rowResponses.length === 1);
          await page
            .getByText('Loading customer details\u2026', { exact: true })
            .waitFor();
          await page.keyboard.press('ArrowDown');
          await details('Row navigation 02');
          await focused(control(1));
          await releaseResponses();
          await details('Row navigation 02');
          await focused(control(1));
          assert(
            await page.getByLabel('Customer code', { exact: true }).isEnabled(),
            'Late customer data must not replace the active code lock',
          );
        } finally {
          if (await page.evaluate(() => !!window.rowOriginalFetch))
            await releaseResponses();
        }
        await holdResponses(['get_customer'], 'row-customer-01');
        try {
          await control(0).click();
          await page.waitForFunction(() => window.rowResponses.length === 1);
          await page
            .getByRole('button', { name: 'New customer', exact: true })
            .click();
          await focused(field);
          await field.fill('New customer in progress');
          await releaseResponses();
          assert.equal(
            await field.inputValue(),
            'New customer in progress',
            'A cancelled read cannot overwrite a new customer',
          );
          await field.fill('');
        } finally {
          if (await page.evaluate(() => !!window.rowOriginalFetch))
            await releaseResponses();
        }
        await control(1).click();
        await details('Row navigation 02');
        await fail('get_customer', async () => {
          await control(0).click();
          await page
            .getByRole('alert')
            .filter({ hasText: 'Injected get_customer failure' })
            .waitFor();
          await details('Row navigation 02');
        });
        assert.equal(
          (await ipc('get_customer', { id: 'row-customer-02' })).customer.name,
          'Row navigation 02',
        );
      } else {
        await page
          .getByRole('button', { name: 'Remove service', exact: true })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Confirm removal', exact: true })
          .click();
        await ready();
        await focused(field);
        await page
          .getByRole('button', { name: 'Edit Row navigation 02', exact: true })
          .waitFor({ state: 'hidden' });
      }
      await shot(`row-navigation-${name.toLowerCase()}`);
    } else {
      await search.fill('IRNA');
      await ready();
      await control(0).click();
      await focused(control(0));
      await page.keyboard.press('ArrowDown');
      await focused(control(1));
      assert.equal(
        await control(1).getAttribute('aria-pressed'),
        'true',
        'Arrows after a mouse preview must select the focused invoice',
      );
      const number = await control(1).textContent();
      await page
        .getByRole('button', { name: `Mark ${number} paid`, exact: true })
        .waitFor();
      await page
        .locator(`canvas[data-rendered="true"][aria-label^="${number},"]`)
        .waitFor();
      await focused(control(1));

      const firstIssued = table().getByRole('button', {
        name: 'Preview IRNA1',
        exact: true,
      });
      const secondIssued = table().getByRole('button', {
        name: 'Preview IRNA2',
        exact: true,
      });
      await secondIssued.click();
      await holdResponses(['get_issued', 'read_pdf'], 'row-draft-01');
      try {
        await firstIssued.click();
        await page.waitForFunction(() => window.rowResponses.length === 2);
        assert.equal(
          await page
            .locator('.detail-panel [data-command="togglePaid"]')
            .count(),
          0,
          'Loading a new selection must hide actions for the previous invoice',
        );
        assert.equal(
          await page
            .locator('.detail-panel canvas[data-rendered="true"]')
            .count(),
          0,
          'Loading a new selection must clear the previous PDF',
        );
        await firstIssued.press('ArrowDown');
        await focused(secondIssued);
        await page
          .getByRole('button', { name: 'Mark IRNA2 paid', exact: true })
          .waitFor();
        const canvas = page.locator(
          'canvas[data-rendered="true"][aria-label^="IRNA2,"]',
        );
        await canvas.waitFor();
        const newestImage = await canvas.evaluate((node) => node.toDataURL());
        await releaseResponses();
        assert.equal(
          await page.locator('#invoice-details-heading').textContent(),
          'IRNA2',
        );
        assert.equal(
          await canvas.evaluate((node) => node.toDataURL()),
          newestImage,
          'Late PDF data must not replace the current invoice',
        );
      } finally {
        if (await page.evaluate(() => !!window.rowOriginalFetch))
          await releaseResponses();
      }
      await holdResponses(['set_paid'], 'row-draft-02');
      try {
        await page
          .getByRole('button', { name: 'Mark IRNA2 paid', exact: true })
          .click();
        await page.waitForFunction(() => window.rowResponses.length === 1);
        await firstIssued.click();
        await page
          .getByRole('button', { name: 'Mark IRNA1 paid', exact: true })
          .waitFor();
        await releaseResponses();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-command="togglePaid"]')
            ?.matches(':enabled'),
        );
        assert.equal(
          await page.locator('#invoice-details-heading').textContent(),
          'IRNA1',
        );
        assert.equal(
          (await ipc('get_issued', { id: 'row-draft-01' })).paid,
          false,
        );
        assert.equal(
          (await ipc('get_issued', { id: 'row-draft-02' })).paid,
          true,
        );
      } finally {
        if (await page.evaluate(() => !!window.rowOriginalFetch))
          await releaseResponses();
      }
      const preview = table().getByRole('button', {
        name: 'Preview IRNA1',
        exact: true,
      });
      await preview.press('Enter');
      await page.locator('#invoice-details-heading').waitFor();
      await focused(page.locator('#invoice-details-heading'));
      await page.keyboard.press('ArrowDown');
      await focused(page.locator('#invoice-details-heading'));
      await page
        .getByRole('button', { name: 'Close invoice details', exact: true })
        .click();
      await focused(preview);
      await search.fill('Row navigation');
      await ready();
      const draft = table().getByRole('link').first();
      const draftId = new URL(
        await draft.getAttribute('href'),
        page.url(),
      ).searchParams.get('id');
      await draft.locator('xpath=ancestor::tr').locator('td').last().click();
      await focused(draft);
      await page
        .getByText('Draft — press Enter to edit', { exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator(
            '.detail-panel canvas, .detail-panel [data-command="togglePaid"], .detail-panel [data-command="openPdf"]',
          )
          .count(),
        0,
      );
      assert.equal(new URL(page.url()).pathname, '/invoices');
      await route('Services');
      await route('Invoices');
      await ready();
      await page
        .getByText('Draft — press Enter to edit', { exact: true })
        .waitFor();
      await page
        .getByRole('button', { name: 'Close invoice details', exact: true })
        .click();
      await focused(page.locator(`[id="invoice-${draftId}"]`));
      await table().getByRole('link').first().press('Enter');
      await page.waitForURL('**/invoices/edit?id=*');
      await route('Invoices');
    }
    checks.push(
      `${name}: row arrows, repeat, boundaries, scrolling, Tab, search, pagination and existing activation preserved`,
    );
  }
}
