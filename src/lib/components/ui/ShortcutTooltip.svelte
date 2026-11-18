<script lang="ts">
import { onMount, tick } from 'svelte';
import { preferences } from '../../preference-store';
import { displayBinding, shortcutBindings } from '../../shortcuts';

let tooltip: HTMLDivElement;
let label = $state('');
let keys = $state<ReturnType<typeof shortcutBindings>>([]);
let disabled = $state(false);

onMount(() => {
  const selector = '[data-command], [data-tooltip-commands], [data-tooltip-label], [data-tooltip-keys]';
  const platform = /Mac/i.test(navigator.platform) ? 'mac' : 'windows';
  let settings = $preferences;
  let anchor: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let focused: HTMLElement | null = null;
  let dismissed: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const titles = new Map<HTMLElement, string>();
  const ids = (node: HTMLElement) => [node.dataset.command ?? '', ...(node.dataset.tooltipCommands ?? '').split(' ')];
  function bindings(node: HTMLElement) {
    const result = shortcutBindings(ids(node), platform, settings.shortcuts[platform]);
    const native = (node.dataset.tooltipKeys ?? '').split(' ').filter(Boolean);
    if (node.closest('dialog') && ids(node).includes('close')) native.push('Escape');
    for (const key of native) if (!result.some(item => item.key === key)) result.push({ key, display: displayBinding(key, platform), aria: key });
    return result;
  }
  const target = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>(selector) : null;
  function eligible(node: HTMLElement | null): node is HTMLElement {
    const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    return !!node?.isConnected && node.getBoundingClientRect().width > 1 && !node.closest('[hidden], [inert]') && (!modal || modal.contains(node));
  }
  function describe(node: HTMLElement, add: boolean) {
    const descriptions = (node.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== tooltip.id);
    if (add) descriptions.push(tooltip.id);
    if (descriptions.length) node.setAttribute('aria-describedby', descriptions.join(' '));
    else node.removeAttribute('aria-describedby');
  }
  function hide() {
    clearTimeout(timer);
    if (anchor) describe(anchor, false);
    anchor = null;
    tooltip.hidePopover();
  }
  function place() {
    if (!eligible(anchor)) { hide(); return; }
    const bounds = anchor.getBoundingClientRect();
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.max(8, Math.min(bounds.left + (bounds.width - width) / 2, innerWidth - width - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.bottom + height + 8 <= innerHeight ? bounds.bottom + 4 : bounds.top - height - 4, innerHeight - height - 8))}px`;
  }
  function content() {
    if (!anchor) return;
    label = anchor.dataset.tooltipLabel || anchor.getAttribute('aria-label') || anchor.textContent?.trim() || '';
    keys = bindings(anchor);
    disabled = anchor.matches(':disabled, [aria-disabled="true"]');
  }
  async function show(node: HTMLElement) {
    if (!eligible(node)) return;
    anchor = node;
    content();
    await tick();
    if (anchor !== node || !eligible(node)) return;
    // Keep the tooltip inside a modal's accessible subtree and above its content.
    (node.closest('dialog[open]') ?? document.body).appendChild(tooltip);
    tooltip.showPopover();
    describe(node, true);
    place();
  }
  function reconcile() {
    clearTimeout(timer);
    const node = hovered ?? focused;
    if (!node) dismissed = null;
    if (node === anchor) return;
    hide();
    if (node !== dismissed) dismissed = null;
    if (!eligible(node) || node === dismissed) return;
    timer = setTimeout(() => void show(node), node === focused ? 0 : 350);
  }
  function pointer(event: PointerEvent) {
    if (event.pointerType === 'touch') return;
    const next = event.type === 'pointerout' ? event.relatedTarget : event.target;
    if (next instanceof Node && tooltip.contains(next)) { clearTimeout(timer); return; }
    if (!target(next) && anchor && !focused) {
      clearTimeout(timer);
      timer = setTimeout(() => { hovered = null; reconcile(); }, 120);
      return;
    }
    hovered = target(next);
    reconcile();
  }
  function focus(event: FocusEvent) {
    focused = target(event.type === 'focusout' ? event.relatedTarget : event.target);
    hovered = null;
    reconcile();
  }
  function dismiss() { dismissed = anchor ?? hovered ?? focused; hide(); }
  function key(event: KeyboardEvent) {
    // Dismiss without consuming existing Escape, editing or navigation shortcuts.
    if (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta') dismiss();
  }
  function sync() {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (node.hasAttribute('title')) { titles.set(node, node.getAttribute('title') ?? ''); node.removeAttribute('title'); }
      const aria = bindings(node).map(key => key.aria).join(' ');
      if (aria) node.setAttribute('aria-keyshortcuts', aria);
      else node.removeAttribute('aria-keyshortcuts');
    }
    for (const node of titles.keys()) if (!node.isConnected) titles.delete(node);
    if (anchor) {
      if (!eligible(anchor)) hide();
      else { content(); void tick().then(() => { if (anchor) place(); }); }
    }
  }
  const unsubscribe = preferences.subscribe(value => { settings = value; sync(); });
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target !== tooltip && !tooltip.contains(record.target))) sync();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-command', 'data-tooltip-commands', 'data-tooltip-label', 'data-tooltip-keys', 'aria-label', 'title', 'disabled', 'aria-disabled', 'hidden', 'inert', 'open'] });
  document.addEventListener('pointerover', pointer, true);
  document.addEventListener('pointerout', pointer, true);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', focus);
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', key, true);
  document.addEventListener('scroll', dismiss, true);
  window.addEventListener('resize', dismiss);
  window.addEventListener('blur', dismiss);
  return () => {
    hide(); unsubscribe(); observer.disconnect();
    document.removeEventListener('pointerover', pointer, true);
    document.removeEventListener('pointerout', pointer, true);
    document.removeEventListener('focusin', focus);
    document.removeEventListener('focusout', focus);
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', key, true);
    document.removeEventListener('scroll', dismiss, true);
    window.removeEventListener('resize', dismiss);
    window.removeEventListener('blur', dismiss);
    for (const [node, title] of titles) node.setAttribute('title', title);
    for (const node of document.querySelectorAll(selector)) node.removeAttribute('aria-keyshortcuts');
    tooltip.remove();
  };
});
</script>

<div bind:this={tooltip} id="shortcut-tooltip" class="shortcut-tooltip" role="tooltip" popover="manual">
  <span>{label}</span>{#each keys as key}<kbd>{key.display}</kbd>{#if key.key === '/'}<span class="note">outside fields</span>{/if}{/each}{#if disabled}<span class="note">Unavailable</span>{/if}
</div>

<style>
.shortcut-tooltip{position:fixed;inset:auto;margin:0;max-width:calc(100vw - calc(16rem / 13));padding:calc(6rem / 13) calc(8rem / 13);border:1px solid var(--line-strong);background:var(--paper);color:var(--ink);box-shadow:0 2px 8px #0003;font-size:calc(12rem / 13);line-height:calc(18rem / 13);overflow-wrap:anywhere}
.shortcut-tooltip:popover-open{display:flex;align-items:center;flex-wrap:wrap;gap:calc(6rem / 13)}
kbd{font:calc(11rem / 13) ui-monospace,monospace;padding:0 calc(4rem / 13);border:1px solid var(--line-strong);background:var(--surface);white-space:nowrap}
.note{font-size:calc(11rem / 13);color:var(--muted)}
</style>
