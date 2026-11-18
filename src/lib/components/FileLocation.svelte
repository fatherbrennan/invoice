<script lang="ts">
import { desktop } from '../desktop';
import { notify } from '../notifications';
import Button from './ui/Button.svelte';

let { path, directory = false }: { path: string; directory?: boolean } = $props();
let busy = $state(false);
async function show() {
  if (busy) return;
  busy = true;
  try {
    await desktop.showLocation(path, directory);
  } catch (cause) {
    notify(`Could not ${directory ? 'open folder' : 'show file in folder'}: ${String(cause)}`, 'error');
    window.dispatchEvent(new Event('invoice:file-location-error'));
  } finally {
    busy = false;
  }
}
</script>

<Button type="button" disabled={busy} onclick={show}>{directory ? 'Open folder' : 'Show in folder'}</Button>
