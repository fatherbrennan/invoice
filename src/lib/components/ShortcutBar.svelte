<script lang="ts">
import { onMount } from 'svelte';
import { preferences, updatePreferences } from '../preference-store';
import { zoomLevels } from '../preferences';
import { type AvailableCommand, activeCommands, executeCommand } from '../shortcut-context';
import { binding, type Context, displayBinding, keyBinding, type Platform, shortcutHints, shouldIgnoreKey, zoomCommands } from '../shortcuts';
import Button from './ui/Button.svelte';

let items = $state.raw<AvailableCommand[]>([]);
let label = $state('Workspace');
let context = $state<Context>('page');
let platform = $state<Platform>('windows');
const shown = $derived(shortcutHints(items, context));
function placeBar(node: HTMLElement) {
  const home = node.parentElement;
  function place() {
    const parent = [...document.querySelectorAll('dialog[open]')].at(-1) ?? home;
    if (parent && node.parentNode !== parent) parent.appendChild(node);
  }
  const observer = new MutationObserver(place);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  place();
  return { destroy() { observer.disconnect(); node.remove(); } };
}
onMount(() => {
  platform = /Mac/i.test(navigator.platform) ? 'mac' : 'windows';
  let focused: Element | null = document.activeElement;
  function refresh() {
    if (!focused?.isConnected) focused = document.activeElement;
    const next = activeCommands(focused);
    label = next.label;
    context = next.context;
    if (next.items.length !== items.length || next.items.some((item, index) => item.command.id !== items[index]?.command.id || item.target !== items[index]?.target || item.disabled !== items[index]?.disabled)) items = next.items;
  }
  function focus(event: Event) {
    if (event.target instanceof Element && !event.target.closest('.shortcut-bar, .scrollbar-layer')) focused = event.target;
    refresh();
  }
  function key(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]')) return;
    const shortcut = keyBinding(event);
    if (!shortcut) return;
    const zoomCommand = zoomCommands.find(command => binding(command, platform, $preferences.shortcuts[platform]) === shortcut);
    if (shouldIgnoreKey(event, !!zoomCommand)) return;
    if (zoomCommand) {
      event.preventDefault();
      const index = zoomLevels.indexOf($preferences.zoom) + (zoomCommand.id === 'zoomIn' ? 1 : -1);
      const zoom = zoomCommand.id === 'resetZoom' ? 100 : zoomLevels[Math.max(0, Math.min(zoomLevels.length - 1, index))];
      if (zoom !== $preferences.zoom) updatePreferences({...$preferences, zoom});
      return;
    }
    refresh();
    const item = items.find(item => binding(item.command, platform, $preferences.shortcuts[platform]) === shortcut);
    if (!item) return;
    event.preventDefault();
    executeCommand(item);
  }
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'open', 'hidden', 'aria-disabled', 'data-command', 'data-shortcut-context'] });
  document.addEventListener('focusin', focus);
  document.addEventListener('pointerdown', focus);
  window.addEventListener('keydown', key);
  refresh();
  return () => { observer.disconnect(); document.removeEventListener('focusin', focus); document.removeEventListener('pointerdown', focus); window.removeEventListener('keydown', key); };
});
</script>
<nav class="shortcut-bar" aria-label="Contextual keyboard shortcuts" use:placeBar>
  <span class="context" title={label}>{label}</span>
  <div class="shortcut-actions">
    {#each shown as item (item.command.id)}
      {@const key = binding(item.command, platform, $preferences.shortcuts[platform])}
      {@const alternate = items.find(candidate => candidate.command.aliasFor === item.command.id)}
      {@const alternateKey = alternate ? binding(alternate.command, platform, $preferences.shortcuts[platform]) : null}
      <Button type="button" class="quiet" disabled={item.disabled} data-tooltip-commands={item.command.id} data-tooltip-label={item.target.getAttribute('aria-label') ?? item.command.label} onpointerdown={event=>event.preventDefault()} onclick={()=>executeCommand(item)}>{#if key}<kbd>{displayBinding(key, platform)}</kbd>{/if}{#if alternateKey && alternateKey !== key}<kbd>{displayBinding(alternateKey, platform)}</kbd>{/if}<span>{item.command.label}</span></Button>
    {/each}
  </div>
  {#if items.some(item=>item.command.id==='preferences')}<a href="/settings/preferences#shortcuts">All shortcuts</a>{/if}
</nav>
<style>
.shortcut-bar{position:fixed;inset:auto 0 0;z-index:30;display:flex;align-items:center;gap:calc(8rem / 13);height:2rem;min-height:2rem;padding:0 calc(10rem / 13);background:var(--paper);border-top:1px solid var(--line-strong);font-size:calc(11rem / 13);color:var(--muted)}.context{max-width:calc(150rem / 13);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-right:1px solid var(--line);padding-right:calc(10rem / 13)}.shortcut-actions{display:flex;flex:1;min-width:0;overflow-x:auto;gap:calc(4rem / 13)}.shortcut-actions :global(button){min-height:calc(24rem / 13);font-size:calc(10rem / 13);padding:1px calc(5rem / 13);gap:calc(6rem / 13)}.shortcut-bar a{white-space:nowrap;padding:calc(3rem / 13) calc(5rem / 13)}.shortcut-bar kbd{font:500 calc(10rem / 13) ui-monospace,monospace;color:var(--ink);background:var(--surface);border:1px solid var(--line-strong);box-shadow:0 1px 0 var(--line-strong);padding:0 calc(4rem / 13);line-height:calc(16rem / 13)}@container app (max-width: calc(700rem / 13)){.context{display:none}.shortcut-bar{padding-inline:calc(4rem / 13);gap:calc(4rem / 13)}}
</style>
