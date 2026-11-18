<script lang="ts">
import { onMount } from 'svelte';
import { type PeriodSelection, periodErrors, periodOptions, reportingToday, resolvePeriod } from '../invoice-period';
import { Button, Field } from './ui';

let { selection = $bindable(), today = $bindable(), onrefresh, busy = false }: {
  selection: PeriodSelection; today: string; onrefresh: () => void; busy?: boolean;
} = $props();
const errors = $derived(periodErrors(selection));
function choose(preset: string) {
  selection = preset === 'custom' ? { ...selection, preset } : resolvePeriod(preset, today);
}
function refresh() {
  const current = reportingToday();
  if (current !== today) {
    today = current;
    if (!['all', 'custom'].includes(selection.preset)) selection = resolvePeriod(selection.preset, today);
  }
  onrefresh();
}
onMount(() => {
  let timer: ReturnType<typeof setTimeout>;
  function schedule() {
    timer = setTimeout(() => {
      if (reportingToday() !== today) refresh();
      schedule();
    }, 60_000 - Date.now() % 60_000);
  }
  const visible = () => { if (document.visibilityState === 'visible') refresh(); };
  schedule();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', visible);
  return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
});
</script>

<section class="invoice-filters" aria-label="Invoice filters">
<div class="filter-row"><fieldset class="period-controls" aria-label="Invoice date range">
  <Field id="invoice-period" label="Invoice date" kind="select" options={periodOptions} bind:value={() => selection.preset, choose}/>
  {#if selection.preset==='custom'}<Field id="invoice-from" label="From (inclusive)" type="date" bind:value={selection.from} error={errors.from} submitted/><Field id="invoice-to" label="To (inclusive)" type="date" bind:value={selection.to} error={errors.to} submitted/>{/if}
</fieldset>{#if !['all','custom'].includes(selection.preset)}<span class="period-range" role="status">{selection.from} to {selection.to}</span>{/if}<Button type="button" disabled={busy || Object.keys(errors).length>0} onclick={refresh}>Refresh</Button></div>
</section>
<style>
.period-range{padding-top:calc(14rem / 13);font-size:calc(12rem / 13);color:var(--muted);white-space:nowrap}.invoice-filters{flex-shrink:0}.filter-row{display:flex;align-items:flex-start;justify-content:flex-end;gap:calc(8rem / 13)}.period-controls{display:flex;flex-wrap:wrap;gap:calc(8rem / 13);min-width:0}.period-controls :global(.admin-field){width:calc(185rem / 13)}.filter-row>:global(button){flex-shrink:0;margin-top:calc(6rem / 13)}
@container app (max-width: calc(620rem / 13)){.period-range{white-space:normal}.filter-row{align-items:start}.period-controls{flex:1}.period-controls :global(.admin-field){width:100%}}
</style>
