<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

let { type, children, class: className = '', ...attributes }: HTMLButtonAttributes & { type: 'button' | 'submit' | 'reset'; children?: Snippet } = $props();
</script>
<button {type} {...attributes} class={className}>{@render children?.()}</button>
