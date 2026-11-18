import assert from 'node:assert/strict';
import test from 'node:test';
import { commands, shortcutHints } from '../src/lib/shortcuts.ts';

// Hint order follows the active workflow, independently of registration or key bindings.
const scenarios = [
  ['list', ['search', 'new', 'previousPage', 'nextPage']],
  ['editor', ['search', 'save', 'addLine', 'openPdf', 'issue', 'new']],
  ['detail', ['search', 'openPdf', 'savePdf', 'togglePaid', 'close', 'new']],
  [
    'preview',
    [
      'search',
      'previousPage',
      'nextPage',
      'expandPreview',
      'openPdf',
      'savePdf',
    ],
  ],
  [
    'picker',
    ['previousPage', 'nextPage', 'save', 'addLine', 'openPdf', 'issue'],
  ],
  ['dialog', ['save', 'close']],
  ['preferences', ['search', 'exportPreferences', 'importPreferences']],
  ['page', ['exportData', 'importData']],
];

for (const [context, expected] of scenarios) {
  test(`${context} hints follow workflow order`, () => {
    const items = commands
      .filter(
        (command) =>
          expected.includes(command.id) ||
          (command.contexts.includes('global') && command.id !== 'nextTab'),
      )
      .reverse()
      .map((command) => ({ command, disabled: command.id === 'save' }));
    const before = [...items];
    assert.deepEqual(
      shortcutHints(items, context).map((item) => item.command.id),
      expected,
    );
    assert.deepEqual(
      items,
      before,
      'Hint ordering must not change keyboard dispatch precedence',
    );
  });
}

test('preview hints retain their local controls when more than six actions are available', () => {
  const items = commands
    .filter((command) => command.id !== 'nextTab')
    .map((command) => ({ command }));
  assert.deepEqual(
    shortcutHints(items, 'preview').map((item) => item.command.id),
    [
      'search',
      'previousPage',
      'nextPage',
      'expandPreview',
      'openPdf',
      'savePdf',
    ],
  );
  assert.deepEqual(shortcutHints([], 'dialog'), []);
});

test('Search is first without nested tabs, with one hint for both bindings', () => {
  const items = commands
    .filter((command) => command.id !== 'nextTab')
    .map((command) => ({ command }));
  for (const context of [
    'page',
    'list',
    'editor',
    'detail',
    'preview',
    'picker',
    'dialog',
    'preferences',
  ]) {
    const hints = shortcutHints(items, context);
    assert.equal(hints[0].command.id, 'search', context);
    assert.equal(
      hints.filter((item) => item.command.id === 'searchSlash').length,
      0,
    );
  }
});

test('Next tab leads available nested-tab hints before Search and local actions', () => {
  for (const [context, expected] of scenarios.filter(
    ([context]) => context !== 'dialog',
  )) {
    const items = commands
      .filter(
        (command) =>
          expected.includes(command.id) || command.contexts.includes('global'),
      )
      .map((command) => ({ command }));
    assert.deepEqual(
      shortcutHints(items, context).map((item) => item.command.id),
      ['nextTab', ...expected].slice(0, 6),
    );
  }
});
