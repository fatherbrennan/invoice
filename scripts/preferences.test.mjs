import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaults,
  loadPreferences,
  parsePreferences,
  preferencesKey,
  savePreferences,
} from '../src/lib/preferences.ts';
import {
  binding,
  commands,
  conflicts,
  displayBinding,
  keyBinding,
  shortcutBindings,
  validBinding,
} from '../src/lib/shortcuts.ts';

// User contracts: portable settings, independent OS bindings, safe imports and contextual conflicts.
test('preferences start with defaults and round-trip both platforms', () => {
  const value = defaults();
  value.theme = 'dark';
  value.invoiceView = 'data';
  value.zoom = 150;
  value.shortcuts.windows.save = 'Ctrl+Shift+S';
  value.shortcuts.mac.save = null;
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  assert.deepEqual(loadPreferences(adapter), defaults());
  assert.deepEqual(savePreferences(adapter, value), value);
  assert.deepEqual(loadPreferences(adapter), value);
  assert.equal(
    JSON.parse(storage.get(preferencesKey)).shortcuts.mac.save,
    null,
  );
  const save = commands.find((item) => item.id === 'save');
  assert.equal(
    binding(save, 'windows', value.shortcuts.windows),
    'Ctrl+Shift+S',
  );
  assert.equal(binding(save, 'mac', value.shortcuts.mac), null);
});

test('older preferences keep their settings and migrate font sizes to zoom presets', () => {
  const legacy = {
    format: 'invoice-preferences',
    version: 1,
    theme: 'dark',
    invoiceView: 'data',
    shortcuts: { windows: { save: 'Ctrl+Shift+S' }, mac: {} },
  };
  assert.equal(defaults().zoom, 100);
  assert.deepEqual(parsePreferences(JSON.stringify(legacy)), {
    ...legacy,
    zoom: 100,
  });
  for (const [fontSize, zoom] of [
    [12, 100],
    [13, 100],
    [14, 100],
    [15, 125],
    [16, 125],
    [17, 125],
    [18, 150],
    [19, 150],
    [20, 150],
  ]) {
    assert.deepEqual(
      parsePreferences(JSON.stringify({ ...legacy, fontSize })),
      { ...legacy, zoom },
    );
  }
  for (const zoom of [50, 75, 100, 125, 150, 175, 200]) {
    const value = { ...legacy, zoom };
    assert.deepEqual(parsePreferences(JSON.stringify(value)), value);
  }
  for (const fontSize of [null, '16', 11, 21, 13.5]) {
    assert.throws(() =>
      parsePreferences(JSON.stringify({ ...legacy, fontSize })),
    );
  }
});

test('tooltip shortcuts follow platform overrides, aliases and unassigned bindings', () => {
  assert.deepEqual(shortcutBindings(['goInvoices'], 'windows', {}), [
    { key: 'Ctrl+1', display: 'Ctrl+1', aria: 'Control+1' },
  ]);
  assert.deepEqual(shortcutBindings(['goInvoices'], 'mac', {}), [
    { key: 'Meta+1', display: '⌘1', aria: 'Meta+1' },
  ]);
  assert.deepEqual(
    shortcutBindings(['search'], 'windows', { search: null }).map(
      (item) => item.key,
    ),
    ['/'],
  );
  assert.deepEqual(
    shortcutBindings(['search'], 'mac', {
      search: 'Alt+F',
      searchSlash: null,
    }).map((item) => item.display),
    ['⌥F'],
  );
  assert.deepEqual(
    shortcutBindings(['nextTab', 'goData'], 'windows', {}).map(
      (item) => item.key,
    ),
    ['Ctrl+Tab', 'Ctrl+5'],
  );
  assert.deepEqual(shortcutBindings(['save'], 'windows', { save: null }), []);
  assert.deepEqual(shortcutBindings(['unknown'], 'windows', {}), []);
});
test('invalid and future settings fail before writing anything', () => {
  const variants = [
    null,
    [],
    { ...defaults(), version: 2 },
    { ...defaults(), theme: 'blue' },
    { ...defaults(), theme: ['dark'] },
    { ...defaults(), invoiceView: ['data'] },
    { ...defaults(), extra: true },
    ...[null, '100', 25, 225, 101, 112.5].map((zoom) => ({
      ...defaults(),
      zoom,
    })),
    { ...defaults(), shortcuts: { windows: {}, mac: { unknown: 'Ctrl+Q' } } },
    { ...defaults(), shortcuts: { windows: { save: 'S' }, mac: {} } },
    { ...defaults(), shortcuts: { windows: { save: 'Ctrl+N' }, mac: {} } },
  ];
  for (const value of variants) {
    assert.throws(() => parsePreferences(JSON.stringify(value)));
    assert.throws(() =>
      savePreferences(
        {
          setItem: () => assert.fail('Invalid settings must never be written'),
        },
        value,
      ),
    );
  }
  assert.throws(() => parsePreferences(' '.repeat(65537)));
  assert.throws(() => parsePreferences('{broken'));
  assert.throws(
    () =>
      savePreferences(
        {
          setItem: () => {
            throw new Error('Storage full');
          },
        },
        defaults(),
      ),
    /Storage full/,
  );
});
test('conflicts account for nested contexts but allow exclusive commands to share keys', () => {
  for (const command of commands) {
    assert(validBinding(command.windows), command.id);
    assert(validBinding(command.mac), command.id);
  }
  assert.deepEqual(conflicts('windows', {}), []);
  assert.deepEqual(conflicts('mac', {}), []);
  assert.match(
    conflicts('windows', { save: 'Ctrl+N' }).join(' '),
    /Save and New/,
  );
  assert.match(
    conflicts('windows', { previousPage: 'Ctrl+S' }).join(' '),
    /Save and Previous page/,
  );
  assert.deepEqual(
    conflicts('windows', { exportPreferences: 'Ctrl+Shift+E' }),
    [],
  );
  assert.deepEqual(conflicts('windows', { save: null, addLine: 'Ctrl+S' }), []);
});
test('key capture preserves Mac versus Windows modifiers and disallows bare typing keys', () => {
  assert.equal(
    keyBinding({
      key: 's',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
    }),
    'Ctrl+Shift+S',
  );
  assert.equal(
    keyBinding({
      key: 's',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: true,
    }),
    'Meta+S',
  );
  assert.equal(displayBinding('Meta+S', 'mac'), '⌘S');
  assert.equal(displayBinding('Ctrl+S', 'windows'), 'Ctrl+S');
  assert.equal(keyBinding({ key: 'Dead' }), null);
  for (const value of [
    'Ctrl+S',
    'Meta+Shift+S',
    'Alt+PageDown',
    'F2',
    'Escape',
  ]) {
    // Canonical modifier order is Ctrl, Alt, Shift, Meta.
    if (value === 'Meta+Shift+S') assert.equal(validBinding(value), false);
    else assert.equal(validBinding(value), true, value);
  }
  for (const value of [
    'S',
    'Enter',
    'Shift+A',
    'Ctrl+Ctrl+S',
    'Ctrl+',
    'Ctrl+Unknown',
  ])
    assert.equal(validBinding(value), false, value);
});

test('slash search is an independent portable binding with conflict checks', () => {
  assert.equal(validBinding('/'), true);
  const alternate = commands.find((item) => item.id === 'searchSlash');
  for (const platform of ['windows', 'mac']) {
    assert.equal(binding(alternate, platform, {}), '/');
    assert.equal(binding(alternate, platform, { searchSlash: null }), null);
    assert.match(
      conflicts(platform, { save: '/' }).join(' '),
      /Save and Search/,
    );
    assert.deepEqual(conflicts(platform, { searchSlash: null, save: '/' }), []);
  }
  const value = defaults();
  value.shortcuts.windows.searchSlash = null;
  value.shortcuts.mac.searchSlash = 'Meta+J';
  assert.deepEqual(parsePreferences(JSON.stringify(value)), value);
});

test('nested tabs use Ctrl+Tab on both platforms and support portable overrides', () => {
  const nextTab = commands.find((item) => item.id === 'nextTab');
  const value = defaults();
  for (const platform of ['windows', 'mac']) {
    assert.equal(binding(nextTab, platform, {}), 'Ctrl+Tab');
    assert.match(
      conflicts(platform, { save: 'Ctrl+Tab' }).join(' '),
      /Save and Next tab/,
    );
    assert.equal(binding(nextTab, platform, { nextTab: null }), null);
    value.shortcuts[platform].nextTab = 'Ctrl+Alt+T';
  }
  assert.deepEqual(parsePreferences(JSON.stringify(value)), value);
});

test('zoom shortcuts use Ctrl on Windows and Command on macOS and remain portable', () => {
  const value = defaults();
  for (const [id, key] of [
    ['zoomIn', '='],
    ['zoomOut', '-'],
    ['resetZoom', '0'],
  ]) {
    const command = commands.find((item) => item.id === id);
    assert(command, id);
    assert.equal(binding(command, 'windows', {}), `Ctrl+${key}`);
    assert.equal(binding(command, 'mac', {}), `Meta+${key}`);
    assert.equal(validBinding(command.windows), true);
    assert.equal(validBinding(command.mac), true);
    assert.equal(binding(command, 'windows', { [id]: null }), null);
    value.shortcuts.windows[id] = `Ctrl+Alt+${key}`;
    value.shortcuts.mac[id] = `Alt+Meta+${key}`;
  }
  assert.deepEqual(parsePreferences(JSON.stringify(value)), value);
  assert.match(
    conflicts('windows', { save: 'Ctrl+=' }).join(' '),
    /Save and Zoom in/,
  );
});

test('legacy shortcut overrides keep precedence over newly introduced zoom defaults', () => {
  const legacy = {
    format: 'invoice-preferences',
    version: 1,
    theme: 'dark',
    invoiceView: 'pdf',
    shortcuts: { windows: { save: 'Ctrl+=' }, mac: { save: 'Meta+-' } },
  };
  const value = parsePreferences(JSON.stringify(legacy));
  assert.equal(value.shortcuts.windows.save, 'Ctrl+=');
  assert.equal(value.shortcuts.windows.zoomIn, null);
  assert.equal(value.shortcuts.mac.save, 'Meta+-');
  assert.equal(value.shortcuts.mac.zoomOut, null);
  assert.deepEqual(parsePreferences(JSON.stringify(value)), value);
});
