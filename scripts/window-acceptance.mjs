import assert from 'node:assert/strict';

// The frame must match the app and operate the real native window.
export async function verifyWindowFrame({ page, button, ipc, checks }) {
  assert.equal(await ipc('plugin:window|is_decorated'), false);
  const titlebar = page.getByRole('region', { name: 'Window title bar' });
  await titlebar.waitFor();
  assert.equal(await ipc('plugin:window|is_resizable'), true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const colours = await titlebar.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      expected: getComputedStyle(document.querySelector('.app-header'))
        .backgroundColor,
    }));
    assert.equal(colours.background, colours.expected);
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await button('Maximize window').focus();
  await page.keyboard.press('Enter');
  await button('Restore window').waitFor();
  assert.equal(await ipc('plugin:window|is_maximized'), true);
  await button('Restore window').click();
  await button('Maximize window').waitFor();
  assert.equal(await ipc('plugin:window|is_maximized'), false);
  checks.push(
    'Custom frame follows light/dark colours; keyboard maximize and restore operate the native window',
  );
}

export async function verifyWindowClose({ page, button, checks, child }) {
  // Preferences acceptance ends in an edited invoice: closing must preserve it.
  const before = await page
    .locator('main input')
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  await button('Close window').click();
  const dialog = page.getByRole('dialog', {
    name: 'Unsaved changes',
    exact: true,
  });
  await dialog.waitFor();
  await button('Keep editing').click();
  assert.deepEqual(
    await page
      .locator('main input')
      .evaluateAll((inputs) => inputs.map((input) => input.value)),
    before,
  );
  await button('Minimize window').click();
  await page.waitForFunction(async () =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized'),
  );
  // CDP can still exercise the close action while the native window is minimized.
  await button('Close window').evaluate((element) => element.click());
  await page.waitForFunction(
    () =>
      document.querySelector('dialog[aria-labelledby="unsaved-heading"]')?.open,
  );
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Discard did not close the native window')),
      10000,
    );
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  await button('Discard and leave').evaluate((element) => element.click());
  assert.equal(await exited, 0);
  checks.push(
    'Native minimize works; close protects dirty edits; Keep editing preserves values; explicit discard exits',
  );
}
