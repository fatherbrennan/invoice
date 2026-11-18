import { tick } from 'svelte';

export async function focusRecord(editorId: string, row?: HTMLElement) {
  await tick();
  if (!row) document.getElementById(editorId)?.focus();
  // Preserve list focus unless the user moved elsewhere while details loaded.
  else if (
    document.activeElement === row ||
    document.activeElement === document.body
  )
    row.focus({ preventScroll: true });
}

export function rowNavigation(
  node: HTMLElement,
  onselect?: (id: string, row: HTMLElement) => void,
) {
  const controls = () => [
    ...node.querySelectorAll<HTMLElement>(
      'tbody [data-row-id]:not(:disabled):not([aria-disabled="true"])',
    ),
  ];
  let active: HTMLElement | null = null;
  let index = 0;
  function remember(event: FocusEvent) {
    const target = event.target;
    active =
      target instanceof HTMLElement && controls().includes(target)
        ? target
        : null;
    if (active) index = controls().indexOf(active);
  }
  async function focus(target: HTMLElement) {
    target.focus({ preventScroll: true });
    if (target.dataset.rowId) onselect?.(target.dataset.rowId, target);
    await tick();
    if (document.activeElement !== target) return;
    const row = target.closest('tr');
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const scroller = target.closest('.table-scroll');
    const header = scroller?.querySelector('thead');
    // Keep upward navigation below the sticky table heading.
    if (row && scroller && header) {
      const overlap =
        header.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
      if (overlap > 0) scroller.scrollTop -= overlap;
    }
  }
  function key(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !['ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    const items = controls();
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return;
    event.preventDefault();
    if (node.getAttribute('aria-busy') === 'true') return;
    const next =
      items[current + (event.key === 'ArrowDown' ? 1 : -1)] ?? items[current];
    if (next) void focus(next);
  }
  function click(event: MouseEvent) {
    const target = event.target;
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      node.getAttribute('aria-busy') === 'true' ||
      !(target instanceof Element) ||
      target.closest('a, button, input, textarea, select, [contenteditable]')
    )
      return;
    const row = target.closest('tbody tr');
    const control = controls().find((item) => item.closest('tr') === row);
    if (control) void focus(control);
  }
  const observer = new MutationObserver(() => {
    if (
      !active ||
      active.isConnected ||
      document.activeElement !== document.body ||
      node.getAttribute('aria-busy') === 'true'
    )
      return;
    const items = controls();
    const next =
      items.find((item) => item.dataset.rowId === active?.dataset.rowId) ??
      items[Math.min(index, items.length - 1)];
    active = null;
    if (next) void focus(next);
    else node.querySelector<HTMLElement>('[data-command="search"]')?.focus();
  });
  observer.observe(node, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  });
  node.addEventListener('keydown', key);
  node.addEventListener('click', click);
  document.addEventListener('focusin', remember);
  return {
    destroy() {
      observer.disconnect();
      node.removeEventListener('keydown', key);
      node.removeEventListener('click', click);
      document.removeEventListener('focusin', remember);
    },
  };
}
