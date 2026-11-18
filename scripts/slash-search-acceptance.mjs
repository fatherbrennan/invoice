import assert from 'node:assert/strict';

export async function verifySlashSearch({ page, route, checks }) {
  await route('Services');
  const search = page.getByLabel('Search services', { exact: true });
  await search.fill('needle');
  await page.locator('main').focus();
  await page.keyboard.press('/');
  assert.equal(
    await search.evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(
    await search.inputValue(),
    'needle',
    'Opening search must not insert the slash',
  );
  await page.keyboard.press('End');
  await page.keyboard.press('/');
  assert.equal(
    await search.inputValue(),
    'needle/',
    'Slash remains text inside search',
  );
  await search.fill('');

  // Native key dispatch with synthetic composition/handled events and editable fixtures.
  await page.evaluate(() => {
    const main = document.querySelector('main');
    for (const options of [
      { key: '?', shiftKey: true },
      { key: '/', ctrlKey: true },
      { key: '/', altKey: true },
      { key: '/', metaKey: true },
      { key: '/', isComposing: true },
      { key: '/', repeat: true },
      { key: '/', modifierAltGraph: true },
      { key: '/', handled: true },
    ]) {
      main.focus();
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...options,
      });
      if (options.handled) event.preventDefault();
      main.dispatchEvent(event);
      if (
        document.activeElement !== main ||
        event.defaultPrevented !== !!options.handled
      )
        throw new Error(`Search intercepted ${JSON.stringify(options)}`);
    }
    for (const kind of [
      'input',
      'textarea',
      'select',
      'contenteditable',
      'textbox',
      'combobox',
    ]) {
      const node = document.createElement(
        ['input', 'textarea', 'select'].includes(kind) ? kind : 'div',
      );
      if (kind === 'contenteditable') node.contentEditable = 'true';
      else if (kind === 'textbox' || kind === 'combobox')
        node.setAttribute('role', kind);
      node.tabIndex = 0;
      main.append(node);
      try {
        node.focus();
        const event = new KeyboardEvent('keydown', {
          key: '/',
          bubbles: true,
          cancelable: true,
        });
        node.dispatchEvent(event);
        if (event.defaultPrevented || document.activeElement !== node)
          throw new Error(`Slash intercepted in ${kind}`);
      } finally {
        node.remove();
      }
    }
  });

  await route('Data');
  await page.locator('main').focus();
  assert.equal(
    await page.locator('main').evaluate((node) =>
      node.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
    true,
  );

  await route('Preferences');
  const bar = page.getByRole('navigation', {
    name: 'Contextual keyboard shortcuts',
  });
  const hint = bar
    .locator('.shortcut-actions button')
    .filter({ hasText: 'Search' });
  assert.deepEqual(await hint.locator('kbd').allTextContents(), [
    'Ctrl+F',
    '/',
  ]);
  await page
    .getByRole('button', {
      name: 'Change Search (alternate) shortcut',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Unassign', exact: true }).click();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('main').focus();
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  assert.deepEqual(await hint.locator('kbd').allTextContents(), ['Ctrl+F']);
  await page.keyboard.press('Control+f');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'shortcut-search',
  );
  await page
    .getByRole('button', {
      name: 'Reset Search (alternate) shortcut',
      exact: true,
    })
    .click();
  await page.locator('main').focus();
  await page.keyboard.press('/');
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'shortcut-search',
  );
  checks.push(
    'Slash focuses search without inserting text; typing, modified keys, composition, handled events and pages without search are preserved; alternate binding can be disabled and reset',
  );
}
