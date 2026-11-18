export type Platform = 'windows' | 'mac';
export type Context =
  | 'global'
  | 'page'
  | 'list'
  | 'editor'
  | 'detail'
  | 'preview'
  | 'picker'
  | 'dialog'
  | 'preferences';
export type Command = {
  id: string;
  label: string;
  contexts: Context[];
  windows: string;
  mac: string;
  aliasFor?: string;
};
const command = (
  id: string,
  label: string,
  contexts: Context[],
  windows: string,
  mac = windows.includes('Ctrl+')
    ? windows.replace('Ctrl+', '').replace(/([^+]+)$/, 'Meta+$1')
    : windows,
): Command => ({ id, label, contexts, windows, mac });
export const zoomCommands = [
  command('zoomIn', 'Zoom in', ['global'], 'Ctrl+='),
  command('zoomOut', 'Zoom out', ['global'], 'Ctrl+-'),
  command('resetZoom', 'Reset zoom', ['global'], 'Ctrl+0'),
];
export const commands: Command[] = [
  command('save', 'Save', ['editor', 'dialog'], 'Ctrl+S'),
  command('new', 'New', ['page'], 'Ctrl+N'),
  command('search', 'Search', ['page', 'preferences'], 'Ctrl+F'),
  {
    ...command(
      'searchSlash',
      'Search (alternate)',
      ['page', 'preferences'],
      '/',
    ),
    aliasFor: 'search',
  },
  command('addLine', 'Add service', ['editor'], 'Ctrl+Shift+L'),
  command('openPdf', 'Open PDF', ['editor', 'detail'], 'Ctrl+Shift+O'),
  command('savePdf', 'Save PDF', ['detail'], 'Ctrl+Shift+S'),
  command('issue', 'Issue invoice…', ['editor'], 'Ctrl+Shift+Enter'),
  command('togglePaid', 'Toggle paid status', ['detail'], 'Ctrl+Shift+M'),
  command(
    'previousPage',
    'Previous page',
    ['list', 'preview', 'picker'],
    'Alt+PageUp',
  ),
  command(
    'nextPage',
    'Next page',
    ['list', 'preview', 'picker'],
    'Alt+PageDown',
  ),
  command('expandPreview', 'Expand preview', ['preview'], 'Ctrl+Shift+F'),
  command('close', 'Close', ['detail', 'dialog'], 'Escape'),
  command('exportData', 'Export data', ['page'], 'Ctrl+Shift+E'),
  command('importData', 'Restore data…', ['page'], 'Ctrl+Shift+I'),
  command(
    'exportPreferences',
    'Export preferences',
    ['preferences'],
    'Ctrl+Shift+E',
  ),
  command(
    'importPreferences',
    'Import preferences…',
    ['preferences'],
    'Ctrl+Shift+I',
  ),
  command('preferences', 'Settings', ['global'], 'Ctrl+,'),
  command('nextTab', 'Next tab', ['global'], 'Ctrl+Tab', 'Ctrl+Tab'),
  command('goInvoices', 'Invoices', ['global'], 'Ctrl+1'),
  command('goCustomers', 'Customers', ['global'], 'Ctrl+2'),
  command('goServices', 'Services', ['global'], 'Ctrl+3'),
  command('goProfile', 'Business profile', ['global'], 'Ctrl+4'),
  command('goData', 'Data settings', ['global'], 'Ctrl+5'),
  ...zoomCommands,
];
export type Overrides = Record<string, string | null>;
// Nested tabs lead when available, then search and the local workflow.
const hintOrder: Record<Context, string[]> = {
  global: [],
  page: ['new', 'exportData', 'importData'],
  list: ['new', 'previousPage', 'nextPage'],
  editor: ['save', 'addLine', 'openPdf', 'issue', 'new'],
  detail: ['openPdf', 'savePdf', 'togglePaid', 'close', 'new'],
  preview: [
    'previousPage',
    'nextPage',
    'expandPreview',
    'openPdf',
    'savePdf',
    'close',
  ],
  picker: [
    'previousPage',
    'nextPage',
    'save',
    'close',
    'addLine',
    'openPdf',
    'issue',
  ],
  dialog: ['save', 'close'],
  preferences: ['exportPreferences', 'importPreferences'],
};
export function shortcutHints<T extends { command: Command }>(
  items: T[],
  context: Context,
): T[] {
  const order = hintOrder[context];
  const rank = (item: T) => {
    if (item.command.id === 'nextTab') return -2;
    if (item.command.id === 'search') return -1;
    const index = order.indexOf(item.command.id);
    return index < 0 ? order.length : index;
  };
  return items
    .filter(
      (item) =>
        !item.command.aliasFor &&
        (item.command.id === 'nextTab' ||
          !item.command.contexts.includes('global')),
    )
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 6);
}
export function binding(
  command: Command,
  platform: Platform,
  overrides: Overrides,
): string | null {
  return Object.hasOwn(overrides, command.id)
    ? overrides[command.id]
    : command[platform];
}
export function shortcutBindings(
  ids: string[],
  platform: Platform,
  overrides: Overrides,
) {
  return commands
    .filter((command) => ids.includes(command.aliasFor ?? command.id))
    .flatMap((command) => {
      const key = binding(command, platform, overrides);
      return key
        ? [
            {
              key,
              display: displayBinding(key, platform),
              aria: key.replace('Ctrl+', 'Control+'),
            },
          ]
        : [];
    });
}
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const specialKeys = [
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Space',
];
export function validBinding(value: string): boolean {
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  if (
    parts.some(
      (part, index) =>
        !modifiers.includes(part) || parts.indexOf(part) !== index,
    )
  )
    return false;
  if (
    parts.join('+') !==
    modifiers.filter((modifier) => parts.includes(modifier)).join('+')
  )
    return false;
  if (
    !/^[A-Z0-9,.;/[\]\\'`=-]$/.test(key) &&
    !/^F([1-9]|1[0-2])$/.test(key) &&
    !specialKeys.includes(key)
  )
    return false;
  // Slash is allowed outside fields; other bare typing/navigation keys stay reserved.
  return (
    ((key === 'Escape' || key === '/') && parts.length === 0) ||
    /^F([1-9]|1[0-2])$/.test(key) ||
    parts.some((part) => part !== 'Shift')
  );
}
export function keyBinding(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
  >,
): string | null {
  if (
    [
      'Control',
      'Alt',
      'Shift',
      'Meta',
      'Dead',
      'Unidentified',
      'Process',
    ].includes(event.key)
  )
    return null;
  const key =
    event.key === ' '
      ? 'Space'
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
    key,
  ]
    .filter(Boolean)
    .join('+');
}
export function displayBinding(
  value: string | null,
  platform: Platform,
): string {
  if (!value) return 'Unassigned';
  if (platform === 'windows') return value.replaceAll('Meta', 'Win');
  return value
    .replaceAll('Ctrl+', '⌃')
    .replaceAll('Alt+', '⌥')
    .replaceAll('Shift+', '⇧')
    .replaceAll('Meta+', '⌘');
}
function overlaps(a: Context[], b: Context[]) {
  // Preview and picker contexts can be nested in an editor or detail panel.
  const ancestors: Partial<Record<Context, Context[]>> = {
    editor: ['page'],
    list: ['page'],
    detail: ['page'],
    preview: ['editor', 'detail', 'page'],
    picker: ['editor', 'dialog', 'page'],
  };
  return a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        x === 'global' ||
        y === 'global' ||
        ancestors[x]?.includes(y) ||
        ancestors[y]?.includes(x),
    ),
  );
}
export function conflicts(platform: Platform, overrides: Overrides): string[] {
  const result: string[] = [];
  for (const [index, item] of commands.entries()) {
    const key = binding(item, platform, overrides);
    if (!key) continue;
    for (const other of commands.slice(index + 1)) {
      if (
        key === binding(other, platform, overrides) &&
        overlaps(item.contexts, other.contexts)
      )
        result.push(
          `${item.label} and ${other.label} both use ${displayBinding(key, platform)}.`,
        );
    }
  }
  return result;
}
export function shouldIgnoreKey(
  event: KeyboardEvent,
  allowRepeat = false,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    (event.repeat && !allowRepeat) ||
    event.getModifierState('AltGraph')
  )
    return true;
  const target = event.target;
  const editing =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      !!target.closest(
        'input, textarea, select, [role="combobox"], [role="textbox"], [role="searchbox"], [role="spinbutton"]',
      ));
  const navigation = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'Backspace',
    'Delete',
  ].includes(event.key);
  return (
    editing &&
    (keyBinding(event) === '/' ||
      ((event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (navigation ||
          ['a', 'c', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase()))) ||
      (event.altKey && !event.ctrlKey && !event.metaKey && navigation))
  );
}
