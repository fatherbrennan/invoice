<script lang="ts">
import { untrack } from 'svelte';
import { page } from '$app/state';
import InvoiceHeader from '../../../lib/components/InvoiceHeader.svelte';
import InvoicePeriod from '../../../lib/components/InvoicePeriod.svelte';
import { Button } from '../../../lib/components/ui';
import { desktop, money } from '../../../lib/desktop';
import type { InvoiceReport } from '../../../lib/domain/types';
import { periodErrors, periodHref, readPeriod, reportingToday, resolvePeriod } from '../../../lib/invoice-period';

let today = $state(reportingToday());
let selection = $state(resolvePeriod('all',reportingToday()));
let report = $state<InvoiceReport|null>(null), loading = $state(true), error = $state(''), revision = $state(0);
const invalid = $derived(Object.keys(periodErrors(selection)).length > 0);
$effect(() => { selection = readPeriod(page.url.searchParams, untrack(() => today)); });
$effect(() => {
  const {from,to} = selection, date = today; void revision;
  report = null; error = '';
  if (invalid) { loading = false; return; }
  loading = true;
  let cancelled = false;
  void desktop.invoiceSummary({from,to},date).then(value => { if (!cancelled) report = value; })
    .catch(cause => { if (!cancelled) error = String(cause); })
    .finally(() => { if (!cancelled) loading = false; });
  return () => { cancelled = true; };
});
const paymentRows = $derived(report ? [
  {label:'All issued',status:'issued',group:report.all},
  {label:'Marked paid',status:'paid',group:report.paid},
  {label:'Unpaid',status:'unpaid',group:report.unpaid},
  {label:'Overdue now',status:'overdue',group:report.overdue,subset:true},
  {label:'Unpaid · no due date',status:'noDueDate',group:report.noDueDate,subset:true},
] : []);
const taxRows = $derived(report ? [
  {label:'Taxable (10% GST)',amounts:report.taxable},
  {label:'GST-free',amounts:report.gstFree},
  {label:'Input taxed',amounts:report.inputTaxed},
  {label:'No GST',amounts:report.noGst},
] : []);
</script>
<svelte:head><title>Invoice summary</title></svelte:head>
<InvoiceHeader {selection} summary status="issued"/>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to scrolling. -->
<section class="page-content invoice-content" aria-label="Invoice summary" tabindex="0">
  <InvoicePeriod bind:selection bind:today busy={loading} onrefresh={() => revision++}/>
  {#if invalid}<p role="status">Choose a valid date range to calculate the summary.</p>
  {:else if loading}<p role="status">Calculating invoice summary…</p>
  {:else if error}<div class="panel panel-body"><p role="alert">Could not calculate the summary: {error}</p><Button type="button" onclick={() => revision++}>Retry summary</Button></div>
  {:else if report}
    <dl class="metrics" aria-label="Issued invoice totals">
      <div><dt>Invoice count</dt><dd>{report.all.count}</dd></div>
      <div><dt>Amount excl. GST</dt><dd>{money(report.all.net)}</dd></div>
      <div><dt>GST</dt><dd>{money(report.all.gst)}</dd></div>
      <div><dt>Total incl. GST</dt><dd>{money(report.all.total)}</dd></div>
    </dl>
    {#if !report.all.count}<p role="status">No issued invoices in this period.</p>{/if}
    <section class="panel" aria-labelledby="payment-heading">
      <div class="panel-heading"><h2 id="payment-heading">Payment status</h2></div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
      <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
      <section class="table-scroll" aria-label="Payment status totals" tabindex="0"><table>
        <thead><tr><th scope="col">Status</th><th scope="col" class="numeric">Invoices</th><th scope="col" class="numeric">Excl. GST</th><th scope="col" class="numeric">GST</th><th scope="col" class="numeric">Incl. GST</th></tr></thead>
        <tbody>{#each paymentRows as row}<tr class:subset={row.subset}><th scope="row"><a href={periodHref('/invoices',selection,row.status)}>{row.label}</a></th><td class="numeric">{row.group.count}</td><td class="numeric">{money(row.group.net)}</td><td class="numeric">{money(row.group.gst)}</td><td class="numeric">{money(row.group.total)}</td></tr>{/each}</tbody>
      </table></section>
      <p class="panel-note">Overdue and no due date are subsets of unpaid. Due today is not overdue.</p>
    </section>
    <section class="panel" aria-labelledby="tax-heading">
      <div class="panel-heading"><h2 id="tax-heading">GST breakdown</h2></div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
      <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
      <section class="table-scroll" aria-label="GST category totals" tabindex="0"><table>
        <thead><tr><th scope="col">Category</th><th scope="col" class="numeric">Excl. GST</th><th scope="col" class="numeric">GST</th><th scope="col" class="numeric">Incl. GST</th></tr></thead>
        <tbody>{#each taxRows as row}<tr><th scope="row">{row.label}</th><td class="numeric">{money(row.amounts.net)}</td><td class="numeric">{money(row.amounts.gst)}</td><td class="numeric">{money(row.amounts.total)}</td></tr>{/each}</tbody>
        <tfoot><tr><th scope="row">Total</th><td class="numeric">{money(report.all.net)}</td><td class="numeric">{money(report.all.gst)}</td><td class="numeric">{money(report.all.total)}</td></tr></tfoot>
      </table></section>
    </section>
    <p class="note">Voided invoices excluded. Issued invoices only; All time includes future dates. Saved invoice amounts. Payment dates and partial payments are not recorded; these figures do not show cash received in the period or a BAS calculation.</p>
  {/if}
</section>
<style>
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;gap:1px;border:1px solid var(--line);background:var(--line)}.metrics>div{padding:calc(12rem / 13);min-width:0;background:var(--paper)}.metrics dt{color:var(--muted);font-size:calc(12rem / 13)}.metrics dd{margin:calc(4rem / 13) 0 0;font-size:calc(19rem / 13);font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}table{min-width:calc(550rem / 13)}tfoot{font-weight:600}tfoot th,tfoot td{border-top:1px solid var(--line-strong);border-bottom:0}.subset th{padding-left:calc(24rem / 13);font-weight:400}.table-scroll{flex:none;max-height:none}
@container app (max-width: calc(900rem / 13)){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container app (max-width: calc(620rem / 13)){.metrics dd{font-size:calc(16rem / 13)}}
</style>
