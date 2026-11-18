import assert from 'node:assert/strict';

export async function verifyNestedTabs({ page, route, checks }) {
  const bar = page.getByRole('navigation', {
    name: 'Contextual keyboard shortcuts',
  });
  const firstHint = bar.locator('.shortcut-actions button').first();
  async function checkHint() {
    assert.equal(await firstHint.locator('span').textContent(), 'Next tab');
    assert.equal(await firstHint.locator('kbd').textContent(), 'Ctrl+Tab');
  }
  await route('Invoices');
  const sections = page.getByRole('navigation', { name: 'Invoice sections' });
  const summaryHref = await sections
    .getByRole('link', { name: 'Summary' })
    .getAttribute('href');
  await page.getByLabel('Search invoices', { exact: true }).focus();
  await checkHint();
  await page.keyboard.press('Control+Tab');
  await page.waitForURL(
    (url) => `${url.pathname}${url.search}` === summaryHref,
  );
  await checkHint();
  const ledgerHref = await sections
    .getByRole('link', { name: 'Ledger' })
    .getAttribute('href');
  await page.keyboard.press('Control+Tab');
  await page.waitForURL((url) => `${url.pathname}${url.search}` === ledgerHref);

  await route('Preferences');
  await checkHint();
  await page.keyboard.press('Control+Tab');
  await page.waitForURL('**/settings/data');
  await checkHint();
  await page.keyboard.press('Control+Tab');
  await page.waitForURL('**/settings/preferences');
  if ((await page.locator('details.shortcuts').getAttribute('open')) === null)
    await page.locator('details.shortcuts > summary').click();

  await page
    .getByRole('button', { name: 'Change Next tab shortcut', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  assert.equal(await bar.getByRole('button', { name: /Next tab/ }).count(), 0);
  await page.keyboard.press('Control+Tab');
  assert.equal(new URL(page.url()).pathname, '/settings/preferences');
  await page
    .getByLabel('New keybinding', { exact: true })
    .press('Control+Shift+Tab');
  assert.equal(
    await page.getByLabel('New keybinding', { exact: true }).inputValue(),
    'Ctrl+Shift+Tab',
  );
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForURL('**/settings/data');
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForURL('**/settings/preferences');
  if ((await page.locator('details.shortcuts').getAttribute('open')) === null)
    await page.locator('details.shortcuts > summary').click();
  await page
    .getByRole('button', { name: 'Change Next tab shortcut', exact: true })
    .click();
  await page.getByRole('button', { name: 'Unassign', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('main').focus();
  await page.keyboard.press('Control+Tab');
  assert.equal(new URL(page.url()).pathname, '/settings/preferences');
  await page
    .getByRole('button', { name: 'Reset Next tab shortcut', exact: true })
    .click();
  await page.keyboard.press('Control+Tab');
  await page.waitForURL('**/settings/data');

  await route('Customers');
  await page.waitForURL('**/customers');
  await page.getByLabel('Search customers', { exact: true }).waitFor();
  assert.equal(await bar.getByRole('button', { name: /Next tab/ }).count(), 0);
  await page.keyboard.press('Control+Tab');
  assert.equal(new URL(page.url()).pathname, '/customers');
  checks.push(
    'Ctrl+Tab cycles both nested tab groups using their existing URLs, works from fields, respects dialogs and disabled bindings, and leaves pages without nested tabs alone',
  );
}
