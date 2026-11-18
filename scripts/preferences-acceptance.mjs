import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseOption } from './combobox-acceptance.mjs';

export async function verifyZoom({
  page,
  route,
  button,
  checks,
  viewport,
  shot,
  preferencesFile,
  ipc,
  fixture,
}) {
  await route('Preferences');
  const zoom = () => page.getByRole('combobox', { name: 'Zoom', exact: true });
  const rootSize = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const expectZoom = async (value) => {
    await page.waitForFunction(
      (value) =>
        getComputedStyle(document.documentElement).fontSize ===
        `${(13 * value) / 100}px`,
      value,
    );
    assert.equal(await zoom().inputValue(), `${value}%`);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('invoice.preferences')).zoom,
      ),
      value,
    );
  };
  assert.equal(await zoom().inputValue(), '100%');
  assert.equal(await rootSize(), '13px');
  await zoom().click();
  assert.deepEqual(await page.getByRole('option').allTextContents(), [
    '50%',
    '75%',
    '100%',
    '125%',
    '150%',
    '175%',
    '200%',
  ]);
  await zoom().press('Escape');
  for (const value of [50, 75, 100, 125, 150, 175, 200]) {
    await chooseOption(zoom(), `${value}%`);
    await expectZoom(value);
    const metrics = await zoom().evaluate((node) => ({
      font: parseFloat(getComputedStyle(node).fontSize),
      height: node.closest('.field-control').getBoundingClientRect().height,
    }));
    assert.equal(metrics.font, (13 * value) / 100);
    assert(Math.abs(metrics.height - (44 * value) / 100) < 1);
  }
  await page.reload();
  await zoom().waitFor();
  await expectZoom(200);
  const nativeScale = await page.evaluate(() => devicePixelRatio);
  for (const [platform, modifier] of [
    ['Win32', 'Control'],
    ['MacIntel', 'Meta'],
  ]) {
    await page.addInitScript(
      (platform) =>
        Object.defineProperty(navigator, 'platform', {
          value: platform,
          configurable: true,
        }),
      platform,
    );
    await page.reload();
    await route('Preferences');
    const search = page.getByLabel('Search commands, keys or context', {
      exact: true,
    });
    await search.fill('Zoom');
    await search.focus();
    await page.keyboard.press(`${modifier}+0`);
    await expectZoom(100);
    for (const value of [125, 150, 175, 200, 200]) {
      await page.keyboard.press(`${modifier}+=`);
      await expectZoom(value);
    }
    for (const value of [175, 150, 125, 100, 75, 50, 50]) {
      await page.keyboard.press(`${modifier}+-`);
      await expectZoom(value);
    }
    assert.equal(await search.inputValue(), 'Zoom');
    await page.keyboard.press(`${modifier}+0`);
    await expectZoom(100);
    await page.keyboard.down(modifier);
    await page.keyboard.down('=');
    await page.keyboard.down('=');
    await page.keyboard.up('=');
    await page.keyboard.up(modifier);
    await expectZoom(150);
    await button('Change Zoom in shortcut').click();
    await page
      .getByLabel('New keybinding', { exact: true })
      .press(`${modifier}+=`);
    assert.equal(
      await rootSize(),
      '19.5px',
      'Recording a shortcut must not change zoom',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await zoom().click();
    await page.keyboard.press(`${modifier}+-`);
    await expectZoom(125);
    await page.waitForFunction(() => {
      const field = document.getElementById('zoom').getBoundingClientRect();
      const popup = document
        .getElementById('zoom-list')
        .closest('.suggestions')
        .getBoundingClientRect();
      return (
        Math.abs(popup.top - field.bottom) < 1 ||
        Math.abs(popup.bottom - field.top) < 1
      );
    });
    await zoom().press('Escape');
    assert.equal(
      await page.evaluate(() => devicePixelRatio),
      nativeScale,
      'Shortcuts must not also apply WebView zoom',
    );
  }
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    }),
  );
  await page.reload();
  await zoom().waitFor();
  await page.keyboard.press('Control+0');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+=');
  await expectZoom(175);
  await ipc('save_profile', { profile: fixture.profile });
  await button('Export preferences').click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Preferences exported to' })
    .last()
    .waitFor();
  const exported = JSON.parse(await readFile(preferencesFile, 'utf8'));
  assert.equal(exported.zoom, 175);
  assert(!Object.hasOwn(exported, 'fontSize'));
  await page.keyboard.press('Control+0');
  await button('Import preferences…').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .focus();
  await page.keyboard.press('Control+-');
  assert.equal(await rootSize(), '9.75px', 'Zoom also works in dialogs');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Replace preferences', exact: true })
    .click();
  await expectZoom(175);
  await page.reload();
  await zoom().waitFor();
  await expectZoom(175);
  await chooseOption(zoom(), '200%');
  await page.waitForFunction(() => {
    const footerTop = document
      .querySelector('.shortcut-bar')
      .getBoundingClientRect().top;
    return [...document.querySelectorAll('[role="scrollbar"]')].every(
      (node) => node.getBoundingClientRect().bottom <= footerTop + 1,
    );
  });
  for (const width of [1280, 800, 390]) {
    await viewport({ width, height: 850 });
    for (const name of [
      'Preferences',
      'Customers',
      'Services',
      'Business profile',
      'Invoices',
    ]) {
      await route(name);
      const overflow = await page
        .locator('.app-header nav')
        .evaluate((node) => node.scrollWidth - node.clientWidth);
      assert(
        overflow <= 1,
        `${name}: navigation clips at ${width}px with 200% zoom`,
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page.getByRole('link', { name: 'New draft', exact: true }).click();
    await page.getByLabel('Quantity 1', { exact: true }).waitFor();
    assert(
      await page
        .locator('.line-items')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      `Invoice fields must fit at ${width}px with 200% zoom`,
    );
    await page.getByLabel('Quantity 1', { exact: true }).fill('2');
    await page.getByLabel('Quantity 1', { exact: true }).fill('1');
    await route('Preferences');
    while (await button('Dismiss notification').count())
      await button('Dismiss notification').first().click();
    await page.locator('details.shortcuts > summary').click();
    await page
      .getByRole('region', { name: 'Settings content', exact: true })
      .evaluate((node) => {
        node.scrollTop = 0;
      });
    await shot(`zoom-200-${width}`);
  }
  await viewport({ width: 1280, height: 850 });
  await page.keyboard.press('Control+0');
  await expectZoom(100);
  checks.push(
    'Zoom presets, Ctrl/Cmd increase/decrease/reset, held keys, limits, fields, dropdown alignment, dialogs, recorder isolation, reload, native export/import and 200% layouts passed; Mac key dispatch simulated in Windows WebView2',
  );
}

// Real WebView2 actions and native file transfers; the parent harness supplies isolated data.
export async function verifyPreferences({
  page,
  route,
  button,
  ipc,
  checks,
  shot,
  viewport,
  preferencesFile,
}) {
  const bar = page.getByRole('navigation', {
    name: 'Contextual keyboard shortcuts',
  });
  await route('Services');
  await page.getByLabel('Search services', { exact: true }).fill('Scale');
  await page.getByRole('status').filter({ hasText: '1–25 of 55' }).waitFor();
  await page.getByLabel('Search services', { exact: true }).focus();
  await page.waitForFunction(() =>
    document.querySelector('[data-command="nextPage"]')?.matches(':enabled'),
  );
  await page.keyboard.press('Alt+PageDown');
  await page.getByRole('status').filter({ hasText: '26–50 of 55' }).waitFor();
  assert.deepEqual(
    await bar.locator('.shortcut-actions button > span').allTextContents(),
    ['Search', 'New', 'Previous page', 'Next page'],
  );
  for (const box of await page
    .locator('main .pagination .icon-button')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const b = node.getBoundingClientRect();
        return { w: b.width, h: b.height, svg: !!node.querySelector('svg') };
      }),
    )) {
    assert.equal(box.w, 32);
    assert.equal(box.h, 32);
    assert(box.svg);
  }
  await page.keyboard.press('Control+n');
  await page
    .getByLabel('Service name', { exact: true })
    .fill('Shortcut acceptance');
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Saved by a contextual shortcut');
  await page.keyboard.press('End');
  await page.keyboard.press('/');
  assert.equal(
    await page.getByLabel('Invoice description', { exact: true }).inputValue(),
    'Saved by a contextual shortcut/',
  );
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Saved by a contextual shortcut');
  await page
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('12.00');
  await page.keyboard.press('Control+a');
  assert.deepEqual(
    await bar.locator('.shortcut-actions button > span').allTextContents(),
    ['Search', 'Save', 'New'],
  );
  assert.equal(
    await page
      .getByLabel('Unit price (AUD, ex GST)', { exact: true })
      .inputValue(),
    '12.00',
  );
  const tax = page.getByRole('combobox', {
    name: 'GST classification',
    exact: true,
  });
  await chooseOption(tax, 'GST-free');
  assert(await tax.evaluate((node) => node === document.activeElement));
  assert.deepEqual(
    await bar.locator('.shortcut-actions button > span').allTextContents(),
    ['Search', 'Save', 'New'],
    'Mouse selection keeps the service editor shortcuts active',
  );
  await page.keyboard.press('Control+s');
  await page
    .getByRole('status')
    .filter({ hasText: 'Service saved.' })
    .last()
    .waitFor();
  assert(
    (
      await ipc('search_services', {
        query: { query: 'Shortcut acceptance', page: 0 },
      })
    ).items.some(
      (item) => item.name === 'Shortcut acceptance' && item.tax === 'gstFree',
    ),
  );
  await page.keyboard.press('Control+f');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'service-search',
  );
  assert.match(await bar.textContent(), /Next page/);
  checks.push(
    'Square SVG paging, contextual list paging and save/search shortcuts use real native data; text selection remains intact',
  );

  await page.keyboard.press('Control+,');
  await page.waitForURL('**/settings/preferences');
  await page
    .getByRole('heading', { name: 'Appearance', exact: true })
    .waitFor();
  await route('Preferences');
  await page
    .getByRole('heading', { name: 'Appearance', exact: true })
    .waitFor();
  await chooseOption(page.getByLabel('Theme', { exact: true }), 'Dark');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark',
  );
  await shot('preferences-dark');
  assert.deepEqual(
    await bar.locator('.shortcut-actions button > span').allTextContents(),
    ['Next tab', 'Search', 'Export preferences', 'Import preferences…'],
  );
  await chooseOption(page.getByLabel('Theme', { exact: true }), 'Light');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light',
  );
  await shot('preferences-light');
  await chooseOption(page.getByLabel('Theme', { exact: true }), 'System');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light',
  );
  await chooseOption(page.getByLabel('Theme', { exact: true }), 'Dark');
  await button('Change Save shortcut').click();
  const dialog = page.getByRole('dialog', {
    name: 'Save · Windows',
    exact: true,
  });
  await page.getByLabel('New keybinding', { exact: true }).press('/');
  assert.match(await dialog.textContent(), /Save and Search \(alternate\)/);
  assert(
    await dialog
      .getByRole('button', { name: 'Apply', exact: true })
      .isDisabled(),
  );
  await page.getByLabel('New keybinding', { exact: true }).press('Control+n');
  assert(
    await dialog
      .getByRole('button', { name: 'Apply', exact: true })
      .isDisabled(),
  );
  assert.match(await dialog.textContent(), /Save and New/);
  await page
    .getByLabel('New keybinding', { exact: true })
    .press('Control+Shift+s');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.reload();
  await page.locator('details.shortcuts > summary').waitFor();
  assert.equal(
    await page.locator('details.shortcuts').getAttribute('open'),
    null,
  );
  await page.locator('details.shortcuts > summary').click();
  await page
    .getByRole('heading', { name: 'Appearance', exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel('Theme', { exact: true }).inputValue(),
    'Dark',
  );
  assert.match(
    await button('Change Save shortcut').textContent(),
    /Ctrl\+Shift\+S/,
  );
  await chooseOption(page.getByLabel('Platform', { exact: true }), 'macOS');
  assert.equal(await button('Change Save shortcut').textContent(), '⌘S');
  await button('Change Save shortcut').click();
  await page
    .getByLabel('New keybinding', { exact: true })
    .press('Meta+Shift+s');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await chooseOption(page.getByLabel('Platform', { exact: true }), 'Windows');
  assert.equal(
    await button('Change Save shortcut').textContent(),
    'Ctrl+Shift+S',
  );
  await button('Change Settings shortcut').click();
  await page.getByLabel('New keybinding', { exact: true }).press('Control+a');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Apply', exact: true })
    .click();
  await button('Export preferences').click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Preferences exported to' })
    .last()
    .waitFor();
  const exported = JSON.parse(await readFile(preferencesFile, 'utf8'));
  assert.equal(exported.theme, 'dark');
  assert.equal(exported.shortcuts.windows.save, 'Ctrl+Shift+S');
  assert.equal(exported.shortcuts.mac.save, 'Shift+Meta+S');
  await button('Reset Save shortcut').click();
  await chooseOption(page.getByLabel('Theme', { exact: true }), 'Light');
  await button('Import preferences…').click();
  await page
    .getByRole('dialog', { name: 'Replace preferences?', exact: true })
    .waitFor();
  await page.keyboard.press('Control+1');
  assert.match(page.url(), /preferences/);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Theme', { exact: true }).inputValue(),
    'Light',
  );
  await button('Import preferences…').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Replace preferences', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Theme', { exact: true }).inputValue(),
    'Dark',
  );
  assert.equal(
    await button('Change Save shortcut').textContent(),
    'Ctrl+Shift+S',
  );
  await button('Import preferences…').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Invalid theme or invoice view.' })
    .waitFor();
  assert.equal(
    await page.getByLabel('Theme', { exact: true }).inputValue(),
    'Dark',
  );
  await button('Dismiss notification').last().click();
  await button('Export preferences').click();
  await button('Import preferences…').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  checks.push(
    'System/light/dark, persisted overrides, Mac modifier recording, conflict prevention and native settings export/import/cancel/invalid-file rejection',
  );

  await viewport({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot('preferences-narrow');
  await viewport({ width: 1280, height: 850 });
  await route('Services');
  await page
    .getByLabel('Search services', { exact: true })
    .fill('Shortcut acceptance');
  await button('Edit Shortcut acceptance').click();
  await page
    .getByLabel('Invoice description', { exact: true })
    .fill('Override saved this edit');
  await page.keyboard.press('Control+a');
  assert.match(page.url(), /services/);
  assert.deepEqual(
    await page
      .getByLabel('Invoice description', { exact: true })
      .evaluate((node) => [node.selectionStart, node.selectionEnd]),
    [0, 24],
  );
  await chooseOption(tax, '10% GST');
  await page.keyboard.press('Control+Shift+s');
  await page
    .getByRole('status')
    .filter({ hasText: 'Service saved.' })
    .last()
    .waitFor();
  const saved = await ipc('search_services', {
    query: { query: 'Shortcut acceptance', page: 0 },
  });
  assert.equal(saved.items[0].description, 'Override saved this edit');
  assert.equal(saved.items[0].tax, 'taxable');
  await page.getByLabel('Invoice description', { exact: true }).fill('Keep me');
  await page.keyboard.press('Control+1');
  await page
    .getByRole('dialog', { name: 'Unsaved changes', exact: true })
    .waitFor();
  await page.keyboard.press('Control+Shift+s');
  assert.equal(
    (
      await ipc('search_services', {
        query: { query: 'Shortcut acceptance', page: 0 },
      })
    ).items[0].description,
    'Override saved this edit',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Keep editing', exact: true })
    .click();
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction(() =>
    document.querySelector('main [data-command="save"]')?.matches(':disabled'),
  );
  checks.push(
    'Imported overrides execute; unsaved-change dialogs block underlying page shortcuts; narrow preferences fit the viewport',
  );
  await route('Invoices');
  await page.getByRole('link', { name: 'New draft', exact: true }).focus();
  await page.keyboard.press('Control+n');
  const picker = page.getByRole('combobox', { name: 'Service 1', exact: true });
  await picker.focus();
  await page.keyboard.press('/');
  assert.equal(await picker.inputValue(), '/');
  await picker.fill('');
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Next services"]')?.matches(':enabled'),
  );
  await page.keyboard.press('Alt+PageDown');
  await page
    .getByRole('option')
    .filter({ hasText: 'Scale service 26' })
    .waitFor();
  assert.deepEqual(
    (
      await bar.locator('.shortcut-actions button > span').allTextContents()
    ).slice(0, 2),
    ['Previous page', 'Next page'],
  );
  await picker.fill('Context service');
  await button('Create service…').click();
  const serviceDialog = page.getByRole('dialog', {
    name: 'Create service',
    exact: true,
  });
  const cancelService = serviceDialog.getByRole('button', {
    name: 'Cancel',
    exact: true,
  });
  await cancelService.focus();
  await page.keyboard.press('/');
  assert(
    await cancelService.evaluate((node) => node === document.activeElement),
  );
  await serviceDialog
    .getByLabel('Invoice description', { exact: true })
    .fill('Saved within the modal');
  await serviceDialog
    .getByLabel('Unit price (AUD, ex GST)', { exact: true })
    .fill('5.00');
  assert.deepEqual(
    await bar.locator('.shortcut-actions button > span').allTextContents(),
    ['Save', 'Close'],
  );
  await page.keyboard.press('Control+Shift+s');
  await serviceDialog.waitFor({ state: 'hidden' });
  assert.equal(
    (
      await ipc('search_services', {
        query: { query: 'Context service', page: 0 },
      })
    ).items[0].description,
    'Saved within the modal',
  );
  checks.push(
    'Picker paging follows focus; the same overridden Save combination creates a service inside a dialog',
  );
}
