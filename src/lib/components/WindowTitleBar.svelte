<script lang="ts">
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMount } from 'svelte';
import { notify } from '../notifications';
import Icon from './Icon.svelte';
import { Button } from './ui';

let visible = $state(false);
let maximized = $state(false);
onMount(() => {
  if (!isTauri()) return;
  const appWindow = getCurrentWindow();
  const update = async () => { maximized = await appWindow.isMaximized(); };
  const listener = appWindow.onResized(() => { void update().catch(reportError); }).catch(reportError);
  void appWindow.isDecorated().then(decorated => { visible = !decorated; }).catch(reportError);
  void update().catch(reportError);
  return () => { void listener.then(unlisten => unlisten?.()).catch(reportError); };
});
function reportError(cause: unknown) { notify(`Could not update window: ${String(cause)}`, 'error'); }
async function control(action: 'minimize' | 'toggleMaximize' | 'close') {
  try { await getCurrentWindow()[action](); } catch (cause) { reportError(cause); }
}
</script>

{#if visible}
  <section class="window-titlebar" aria-label="Window title bar">
    <div class="window-drag-region" data-tauri-drag-region>Invoice</div>
    <div class="window-controls">
      <!-- shortcut: custom controls lack Windows hover Snap Layouts; add native hit testing if required. -->
      <Button type="button" aria-label="Minimize window" title="Minimize" onclick={() => control('minimize')}><Icon name="minimize" size={16}/></Button>
      <Button type="button" aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onclick={() => control('toggleMaximize')}><Icon name={maximized ? 'restore' : 'maximize'} size={16}/></Button>
      <Button type="button" class="window-close" aria-label="Close window" title="Close" onclick={() => control('close')}><Icon name="close" size={16}/></Button>
    </div>
  </section>
{/if}

<style>
  .window-titlebar {
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    height: var(--window-titlebar-height);
    background: var(--paper);
    color: var(--ink);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }
  .window-drag-region {
    flex: 1;
    padding: calc(7rem / 13) calc(16rem / 13);
    font-size: calc(12rem / 13);
    font-weight: 600;
    -webkit-app-region: drag;
  }
  .window-controls { display: flex; }
  .window-controls :global(button) {
    width: calc(44rem / 13);
    min-height: calc(32rem / 13);
    padding: 0;
    border: 0;
    background: transparent;
  }
  .window-controls :global(button:hover) { background: var(--soft); }
  .window-controls :global(button:focus-visible) { outline-offset: -3px; }
  .window-controls :global(.window-close:hover) {
    background: var(--danger);
    color: var(--paper);
  }
</style>
