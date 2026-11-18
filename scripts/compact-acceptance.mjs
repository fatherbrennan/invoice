import assert from 'node:assert/strict';
import { chooseOption } from './combobox-acceptance.mjs';

export async function verifyCompactUi({ page, route, viewport, checks, shot }) {
  const tabs = page.getByRole('navigation', { name: 'Main navigation' });
  assert.equal(
    await tabs.getByRole('link', { name: 'Settings', exact: true }).count(),
    1,
  );
  assert.equal(
    await tabs.getByRole('link', { name: /^(Preferences|Data)$/ }).count(),
    0,
  );
  await route('Preferences');
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  await chooseOption(theme, 'Light');
  assert.equal(await page.locator('select').count(), 0);
  const bar = page.getByRole('navigation', {
    name: 'Contextual keyboard shortcuts',
  });
  assert((await bar.boundingBox()).height <= 26);
  assert(
    await bar
      .locator('kbd')
      .first()
      .evaluate((node) => getComputedStyle(node).borderTopStyle === 'solid'),
  );
  const table = page.getByRole('region', { name: 'Keyboard bindings table' });
  await page
    .getByLabel('Search commands, keys or context', { exact: true })
    .fill('Editing');
  await table
    .getByRole('button', { name: 'Change Save shortcut', exact: true })
    .waitFor();
  assert.equal(
    await table
      .getByRole('button', { name: 'Change Export data shortcut', exact: true })
      .count(),
    0,
  );
  await page
    .getByLabel('Search commands, keys or context', { exact: true })
    .fill('');
  await table
    .getByRole('button', { name: 'Change Export data shortcut', exact: true })
    .waitFor();
  assert((await table.locator('tbody tr').first().boundingBox()).height <= 32);
  const width = await theme.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  assert.equal(await theme.getAttribute('readonly'), '');
  await theme.focus();
  assert.equal(
    await theme.inputValue(),
    'Light',
    'Fixed choices retain their current value on focus',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'light',
  );
  await theme.press('Escape');
  assert.equal(await theme.inputValue(), 'Light');
  await theme.click();
  await theme.press('End');
  await theme.press('Enter');
  assert.equal(await theme.inputValue(), 'Dark');
  assert.equal(
    await theme.evaluate((node) => node.getBoundingClientRect().width),
    width,
  );
  await chooseOption(theme, 'Light');
  const id = await table.getAttribute('id');
  const track = page.locator(
    `[role="scrollbar"][aria-controls="${id}"][aria-orientation="vertical"]`,
  );
  await track.waitFor();
  const thumb = await track.locator('.scroll-thumb').boundingBox();
  await page.mouse.move(thumb.x + 3, thumb.y + 5);
  await page.mouse.down();
  await page.mouse.move(thumb.x + 3, thumb.y + 70);
  await page.mouse.up();
  assert(await table.evaluate((node) => node.scrollTop > 0));
  assert(
    await table.evaluate((node) => {
      const css = getComputedStyle(node);
      return (
        node.offsetWidth -
          node.clientWidth -
          parseFloat(css.borderLeftWidth) -
          parseFloat(css.borderRightWidth) <
        1
      );
    }),
  );
  await table.evaluate((node) => (node.scrollTop = 0));
  await shot('settings-compact');
  for (const [width, height] of [
    [1280, 850],
    [760, 600],
    [390, 300],
  ]) {
    await viewport({ width, height });
    for (const name of [
      'Invoices',
      'Customers',
      'Services',
      'Business profile',
      'Preferences',
      'Data',
    ]) {
      await route(name);
      await page
        .getByRole('heading', {
          level: 1,
          name: name === 'Preferences' || name === 'Data' ? 'Settings' : name,
          exact: true,
        })
        .waitFor();
      assert(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth &&
            scrollY === 0,
        ),
        `${name} ${width}: window must not scroll`,
      );
      assert((await bar.boundingBox()).y + 26 <= height + 1);
    }
  }
  await viewport({ width: 1280, height: 850 });
  await route('Preferences');
  await page.emulateMedia({ forcedColors: 'active' });
  assert(
    await page
      .locator('.scroll-thumb')
      .first()
      .evaluate(
        (node) =>
          getComputedStyle(node).backgroundColor !==
          getComputedStyle(document.body).backgroundColor,
      ),
  );
  await page.emulateMedia({ forcedColors: 'none' });
  checks.push(
    'One Settings tab, 26px boxed-key strip, compact shortcut rows, keyboard comboboxes with fixed-choice mode, draggable overlay scrollbars without gutters, and no window scrolling at desktop/short/narrow sizes',
  );
}
