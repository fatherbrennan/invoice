<script lang="ts">
let { label, items }: { label: string; items: {label: string; href: string; current: boolean; command?: string}[] } = $props();
const next = $derived((items.findIndex(item => item.current) + 1) % items.length);
</script>
<nav class="section-tabs" aria-label={label}>
  {#each items as item, index(item.href)}<a href={item.href} data-tooltip-label={item.label} data-tooltip-commands={item.command} data-command={items.length > 1 && index === next ? 'nextTab' : undefined} aria-current={item.current?'page':undefined}>{item.label}</a>{/each}
</nav>
