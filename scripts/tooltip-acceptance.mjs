import assert from 'node:assert/strict';
import { commands } from '../src/lib/shortcuts.ts';

export async function verifyShortcutTooltips({
  page,
  route,
  ipc,
  fixture,
  checks,
}) {
  const tooltip = page.getByRole('tooltip');
  const seen = new Set();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  async function inspect(control, expected, focus = false) {
    await control.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.locator('main').focus();
    await tooltip.waitFor({ state: 'hidden' });
    if (focus) await control.focus();
    else await control.hover();
    await tooltip.waitFor().catch(async (error) => {
      throw new Error(
        `Tooltip missing for ${await control.evaluate((node) => node.outerHTML)}`,
        { cause: error },
      );
    });
    if (expected)
      assert.deepEqual(
        await tooltip.locator('kbd').allTextContents(),
        expected,
      );
    assert.equal(
      await control.getAttribute('title'),
      null,
      'No duplicate native tooltip',
    );
    assert.match(
      await control.getAttribute('aria-describedby'),
      /shortcut-tooltip/,
    );
    if (
      await control.evaluate((node) =>
        node.matches(':disabled, [aria-disabled="true"]'),
      )
    )
      assert.match(await tooltip.textContent(), /Unavailable/);
    const bounds = await tooltip.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width &&
        bounds.y + bounds.height <= viewport.height,
    );
    for (const id of await control.evaluate((node) =>
      [
        node.dataset.command,
        ...(node.dataset.tooltipCommands ?? '').split(' '),
      ].filter(Boolean),
    ))
      seen.add(id);
  }
  async function inspectPage() {
    const controls = page.locator(
      '[data-command], main [data-tooltip-commands], main [data-tooltip-keys]',
    );
    for (const control of await controls.all()) {
      if (await control.evaluate((node) => !!node.closest('.app-header')))
        continue;
      const box = await control.boundingBox();
      if (!box || box.width <= 1 || box.height <= 1) continue;
      await inspect(control);
    }
    for (const control of await page.locator('.shortcut-actions button').all())
      await inspect(control);
  }
  await route('Invoices');
  for (const [name, key] of [
    ['Invoices', 'Ctrl+1'],
    ['Customers', 'Ctrl+2'],
    ['Services', 'Ctrl+3'],
    ['Business profile', 'Ctrl+4'],
    ['Settings', 'Ctrl+,'],
  ]) {
    await inspect(nav.getByRole('link', { name, exact: true }), [key]);
    await inspect(nav.getByRole('link', { name, exact: true }), [key], true);
  }
  console.log('Tooltip header hover and focus checks passed');
  await inspect(nav.getByRole('link', { name: 'Invoices', exact: true }), [
    'Ctrl+1',
  ]);
  await tooltip.hover();
  assert(await tooltip.isVisible(), 'Tooltip remains readable while hovered');
  await page.keyboard.press('Escape');
  await tooltip.waitFor({ state: 'hidden' });
  assert.equal(new URL(page.url()).pathname, '/invoices');
  await inspectPage();
  await inspect(
    page.getByLabel('Search invoices', { exact: true }),
    ['Ctrl+F', '/'],
    true,
  );
  assert.match(await tooltip.textContent(), /outside fields/);
  await page
    .getByRole('navigation', { name: 'Invoice sections' })
    .getByRole('link', { name: 'Summary' })
    .click();
  await page.waitForURL('**/invoices/summary?**');
  await inspectPage();
  for (const name of [
    'Customers',
    'Services',
    'Business profile',
    'Data',
    'Preferences',
  ]) {
    await route(name);
    await page.waitForURL(
      (url) =>
        url.pathname ===
        {
          Customers: '/customers',
          Services: '/services',
          'Business profile': '/profile',
          Data: '/settings/data',
          Preferences: '/settings/preferences',
        }[name],
    );
    await inspectPage();
  }
  const change = page.getByRole('button', {
    name: 'Change Invoices shortcut',
    exact: true,
  });
  await change.click();
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.hover();
  await tooltip.waitFor();
  assert.deepEqual(await tooltip.locator('kbd').allTextContents(), ['Escape']);
  assert(
    await tooltip.evaluate((node) => !!node.closest('dialog[open]')),
    'Tooltip belongs to the modal',
  );
  await page
    .getByLabel('New keybinding', { exact: true })
    .press('Control+Alt+9');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await inspect(nav.getByRole('link', { name: 'Invoices', exact: true }), [
    'Ctrl+Alt+9',
  ]);
  await change.click();
  await page.getByRole('button', { name: 'Unassign', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await inspect(nav.getByRole('link', { name: 'Invoices', exact: true }), []);
  await page
    .getByRole('button', { name: 'Reset Invoices shortcut', exact: true })
    .click();
  console.log(
    'Tooltip page coverage and custom/unassigned binding checks passed',
  );

  const customer = {
    ...fixture.customer,
    id: 'tooltip-customer',
    code: 'TIP',
    name: 'Tooltip customer',
    nextNumber: 1,
  };
  await ipc('save_profile', { profile: fixture.profile });
  await ipc('save_customer', { customer });
  const services = [];
  for (let i = 0; i < 26; i++) {
    const service = {
      id: `tooltip-service-${i}`,
      name: `Tooltip service ${i}`,
      description: 'Tooltip fixture',
      unitPrice: '10',
      tax: 'taxable',
    };
    await ipc('save_service', { service });
    services.push(service);
  }
  const draft = {
    ...fixture.draft,
    id: 'tooltip-issued',
    customerId: customer.id,
    lines: [
      {
        service: { id: services[0].id, name: services[0].name },
        description: 'Tooltip fixture',
        quantity: '1',
        unitPrice: '10',
        tax: 'taxable',
      },
    ],
  };
  await ipc('save_draft', { draft });
  await ipc('issue', { id: draft.id });
  const issued = await ipc('get_issued', { id: draft.id });
  await route('Invoices');
  await page.waitForURL((url) => url.pathname === '/invoices');
  await page.getByLabel('Search invoices', { exact: true }).fill('TIP');
  await page
    .getByRole('button', {
      name: `Preview ${issued.snapshot.number}`,
      exact: true,
    })
    .click();
  await page.locator('canvas[data-rendered="true"]').waitFor();
  await inspectPage();
  await page
    .getByRole('button', { name: 'Expand PDF preview', exact: true })
    .click();
  const closePreview = page.getByRole('button', {
    name: 'Close preview',
    exact: true,
  });
  await page
    .getByRole('dialog', { name: 'Expanded PDF preview' })
    .locator('img')
    .evaluate((img) => img.decode());
  await closePreview.evaluate((node) => node.blur());
  await page.mouse.move(0, 0);
  await closePreview.hover();
  await tooltip.waitFor();
  assert.deepEqual(await tooltip.locator('kbd').allTextContents(), ['Escape']);
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Expanded PDF preview' })
    .waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const tip = document.getElementById('shortcut-tooltip');
    return !tip?.matches(':popover-open') || !tip.closest('dialog');
  });
  console.log('Tooltip issued invoice, PDF and modal checks passed');

  await ipc('save_draft', { draft: { ...draft, id: 'tooltip-draft' } });
  await route('Invoices');
  await page
    .getByRole('link', { name: 'Edit draft for Tooltip customer', exact: true })
    .click();
  await page.waitForURL('**/invoices/edit?id=tooltip-draft');
  await inspectPage();
  const picker = page.getByRole('combobox', { name: 'Service 1', exact: true });
  await picker.fill('Tooltip service');
  await page
    .getByRole('button', { name: 'Next services', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Next services', exact: true })
    .hover();
  await tooltip.waitFor();
  assert.deepEqual(await tooltip.locator('kbd').allTextContents(), [
    'Alt+PageDown',
  ]);
  await picker.fill('Tooltip create');
  await page
    .getByRole('button', { name: 'Create service…', exact: true })
    .click();
  const modal = page.getByRole('dialog', {
    name: 'Create service',
    exact: true,
  });
  const save = modal.getByRole('button', {
    name: 'Create and select',
    exact: true,
  });
  await save.hover();
  await tooltip.waitFor();
  assert.deepEqual(await tooltip.locator('kbd').allTextContents(), ['Ctrl+S']);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Tooltip acceptance notes');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Draft saved.' }).waitFor();
  await route('Preferences');
  await page.waitForURL('**/settings/preferences');
  for (const service of services)
    await ipc('delete_service', { id: service.id });
  await page.addInitScript(() => {
    if (localStorage.getItem('tooltip-test-mac'))
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
  });
  await page.evaluate(() => localStorage.setItem('tooltip-test-mac', '1'));
  try {
    await page.reload();
    await inspect(nav.getByRole('link', { name: 'Invoices', exact: true }), [
      '⌘1',
    ]);
    await inspect(
      nav.getByRole('link', { name: 'Settings', exact: true }),
      ['⌘,'],
      true,
    );
    await inspect(
      page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('link', { name: 'Data', exact: true }),
      ['⌃Tab', '⌘5'],
    );
  } finally {
    await page.evaluate(() => localStorage.removeItem('tooltip-test-mac'));
    await page.reload();
  }
  seen.add('searchSlash'); // Verified as the search control's second binding above.
  assert.deepEqual(
    commands.map((command) => command.id).filter((id) => !seen.has(id)),
    [],
    'Every registered shortcut has a visible tooltip target',
  );
  checks.push(
    'Shortcut tooltips cover every command, header and nested navigation, status buttons, fields, disabled controls, PDF preview, service picker and dialogs; hover/focus, Escape, custom/unassigned bindings and viewport containment pass',
  );
}
