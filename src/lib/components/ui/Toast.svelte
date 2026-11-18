<script lang="ts">
import { dismissNotification, type Notification } from '../../notifications';
import FileLocation from '../FileLocation.svelte';
import Icon from '../Icon.svelte';
import Button from './Button.svelte';

let { notification }: { notification: Notification } = $props();
let hovered = $state(false), focused = $state(false);
let returnFocus: HTMLElement | null = null;
function dismiss() {
  if (focused && returnFocus?.isConnected) returnFocus.focus();
  dismissNotification(notification.id);
}
$effect(() => {
  if (notification.kind === 'error' || hovered || focused) return;
  const timer = setTimeout(() => dismissNotification(notification.id), 6000);
  return () => clearTimeout(timer);
});
</script>

<!-- biome-ignore lint/a11y/noStaticElementInteractions: Pointer and focus events only pause dismissal; the live region is not an interactive control. -->
<div class="toast" class:error={notification.kind === 'error'} role={notification.kind === 'error' ? 'alert' : 'status'} aria-atomic="true" onmouseenter={() => hovered = true} onmouseleave={() => hovered = false} onfocusin={event => { focused = true; if (!event.currentTarget.contains(event.relatedTarget as Node)) returnFocus = event.relatedTarget as HTMLElement | null; }} onfocusout={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) focused = false; }}>
  <div class="content"><strong>{notification.kind === 'error' ? 'Error' : notification.kind === 'info' ? 'Notice' : 'Done'}</strong><p>{notification.message}</p>{#each notification.links as link (link.href)}<a href={link.href}>{link.label}</a>{/each}{#if notification.filePath}<FileLocation path={notification.filePath}/>{/if}</div>
  <Button class="quiet" type="button" aria-label="Dismiss notification" onclick={dismiss}><Icon name="close" size={16}/></Button>
</div>

<style>
.toast{display:flex;align-items:flex-start;gap:calc(8rem / 13);padding:calc(10rem / 13) calc(12rem / 13);border:1px solid var(--line-strong);border-left:3px solid var(--accent);background:var(--paper);color:var(--ink);box-shadow:0 4px 16px #20352a26;pointer-events:auto;font-size:calc(12rem / 13)}
.content{flex:1;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}.content strong{color:var(--accent);font-size:calc(11rem / 13)}.content p{margin:calc(2rem / 13) 0 0;font-size:calc(12rem / 13)}.error{border-left-color:var(--danger)}.error strong{color:var(--danger)}.toast > :global(button){flex-shrink:0;padding:0;min-width:calc(32rem / 13);min-height:calc(32rem / 13)}
.content a{display:block;margin-top:calc(4rem / 13)}
.content > :global(button){margin-top:calc(8rem / 13)}
</style>
