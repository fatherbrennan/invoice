<script lang="ts">
import Icon from '../Icon.svelte';
import Button from './Button.svelte';

let { page, total, pageSize = 25, busy = false, onchange }: {page: number; total: number; pageSize?: number; busy?: boolean; onchange: (page: number) => void} = $props();
</script>
<nav class="pagination" aria-label="Result pages">
  <span role="status">{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total}` : '0 results'}</span>
  <div class="actions"><Button class="icon-button" type="button" data-command="previousPage" aria-label="Previous page" title="Previous page" disabled={busy || page === 0} onclick={() => onchange(page - 1)}><Icon name="left" size={16}/></Button><Button class="icon-button" type="button" data-command="nextPage" aria-label="Next page" title="Next page" disabled={busy || (page + 1) * pageSize >= total} onclick={() => onchange(page + 1)}><Icon name="right" size={16}/></Button></div>
</nav>
<style>.pagination{display:flex;align-items:center;justify-content:space-between;gap:calc(8rem / 13);padding:calc(7rem / 13) calc(12rem / 13);border-top:1px solid var(--line);font-size:calc(11rem / 13)}.pagination [role="status"]{background:none;padding:0;margin:0;color:var(--muted)}</style>
