<script lang="ts">
import { notifications } from '../../notifications';
import Toast from './Toast.svelte';

function placeHost(node: HTMLElement) {
  // A modal makes outside content inert; keep notifications inside its top layer.
  function place() {
    const parent = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
    if (node.parentNode !== parent) parent.appendChild(node);
  }
  place();
  const observer = new MutationObserver(place);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  return { destroy() { observer.disconnect(); node.remove(); } };
}
</script>

<section class="toast-host" aria-label="Notifications" use:placeHost>
  {#each $notifications as notification (notification.id)}<Toast {notification}/>{/each}
</section>

<style>
.toast-host{position:fixed;z-index:1000;right:calc(16rem / 13);bottom:calc(34rem / 13);width:min(calc(380rem / 13),calc(100vw - calc(32rem / 13)));max-height:calc(100dvh - calc(32rem / 13));display:flex;flex-direction:column;gap:calc(8rem / 13);overflow-y:auto;overscroll-behavior:contain;pointer-events:none;padding:calc(4rem / 13);margin:0}
</style>
