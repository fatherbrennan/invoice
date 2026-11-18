<script lang="ts">
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMount } from 'svelte';
import { beforeNavigate, goto } from '$app/navigation';
import { notify } from '../notifications';
import { Button } from './ui';

let { dirty }: { dirty: boolean } = $props();
let dialog = $state<HTMLDialogElement>();
let destination = '';
let leaving = false;
let closingWindow = false;
beforeNavigate(navigation => {
  if (!dirty || leaving || !navigation.to) return;
  navigation.cancel();
  destination = navigation.to.url.href;
  closingWindow = false;
  dialog?.showModal();
});
onMount(() => {
  const guard = (event: BeforeUnloadEvent) => { if (dirty && !leaving) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  const listener = isTauri() ? getCurrentWindow().onCloseRequested(event => {
    if (!dirty || leaving) return;
    event.preventDefault();
    closingWindow = true;
    dialog?.showModal();
  }).catch(cause => { notify(`Could not protect unsaved changes: ${String(cause)}`, 'error'); }) : undefined;
  return () => {
    window.removeEventListener('beforeunload', guard);
    void listener?.then(unlisten => unlisten?.());
  };
});
async function leave() {
  leaving = true;
  dialog?.close();
  try {
    if (closingWindow) await getCurrentWindow().close();
    else await goto(destination);
  } catch (cause) {
    leaving = false;
    notify(`Could not leave: ${String(cause)}`, 'error');
  }
}
</script>
<dialog data-shortcut-context="dialog" bind:this={dialog} aria-labelledby="unsaved-heading"><h2 id="unsaved-heading">Unsaved changes</h2><p>Leave without saving your changes?</p><div class="actions"><Button data-command="close" type="button" class="primary" onclick={() => dialog?.close()}>Keep editing</Button><Button type="button" onclick={leave}>Discard and leave</Button></div></dialog>
