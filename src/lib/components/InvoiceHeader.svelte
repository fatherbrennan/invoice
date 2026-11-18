<script lang="ts">
import { type PeriodSelection, periodHref } from '../invoice-period';
import {ledgerMemory} from '../ledger-memory.svelte';
import Breadcrumbs from './Breadcrumbs.svelte';
import { SectionTabs } from './ui';

let { selection, summary = false, status = 'all' }: {selection: PeriodSelection; summary?: boolean; status?: string} = $props();
</script>
<div class="page-heading"><Breadcrumbs current="Invoices"/><a data-command="new" class="button primary" href="/invoices/edit">New draft</a></div>
<SectionTabs label="Invoice sections" items={[
  {label:'Ledger',href:summary?ledgerMemory.href:periodHref('/invoices',selection,status),current:!summary,command:'goInvoices'},
  {label:'Summary',href:periodHref('/invoices/summary',selection),current:summary},
]}/>
