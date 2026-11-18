<script lang="ts">
import {onMount,tick,untrack} from 'svelte';
import {beforeNavigate,goto} from '$app/navigation';
import {page as routePage} from '$app/state';
import InvoiceHeader from '../../lib/components/InvoiceHeader.svelte';
import InvoicePeriod from '../../lib/components/InvoicePeriod.svelte';
import PdfPreview from '../../lib/components/PdfPreview.svelte';
import {Button,Field,Pagination} from '../../lib/components/ui';
import {desktop,money} from '../../lib/desktop';
import type {InvoiceSummary,Issued,Page} from '../../lib/domain/types';
import {displayValue} from '../../lib/format';
import {periodErrors,periodHref,readPeriod,reportingToday,resolvePeriod} from '../../lib/invoice-period';
import {ledgerMemory} from '../../lib/ledger-memory.svelte';
import { notify } from '../../lib/notifications';
import { paymentText } from '../../lib/payments';
import { preferences, updatePreferences } from '../../lib/preference-store';
import { focusRecord, rowNavigation } from '../../lib/row-navigation';
import {fieldErrors,searchSchema} from '../../lib/validation';

let today=$state(reportingToday()), selection=$state(resolvePeriod('all',reportingToday()));
const invalidPeriod=$derived(Object.keys(periodErrors(selection)).length>0);
$effect(()=>{selection=readPeriod(routePage.url.searchParams,untrack(()=>today));filter=routePage.url.searchParams.get('status') ?? 'all';});
let result=$state<Page<InvoiceSummary>>({items:[],total:0,page:0,pageSize:25});
let search=$state(routePage.url.searchParams.get('q')??''), filter=$state('all'), page=$state(Math.max(0,Number(routePage.url.searchParams.get('page'))||0)), revision=$state(0);
let setup=$state<{profile:boolean;customer:boolean}|null>(null);
let restoredPage=false;
let selected=$state<Issued|null>(null), selectedId=$state(''), pdf=$state(''), tab=$state<'pdf'|'data'>('pdf');
const selectedKind=$derived(result.items.find(item=>item.id===selectedId)?.kind);
let selectionQuery='';
let detailError=$state(''),detailRevision=$state(0),pdfRevision=$state(0);
function selectRow(id:string){if(id!==selectedId){selected=null;pdf='';selectedId=id;}}
async function selectInvoice(id:string,row?:HTMLElement){selectRow(id);await focusRecord('invoice-details-heading',row);}
function selectTab(value:'pdf'|'data') {
 updatePreferences({...$preferences, invoiceView:value});
}
$effect(()=>{tab=$preferences.invoiceView;});
async function closeDetails(){const id=selectedId;selectedId='';await tick();document.getElementById(`invoice-${id}`)?.focus();}
let loading=$state(true), busy=$state(false), previewPending=$state(false), previewError=$state(''), error=$state('');
$effect(()=>{const term=search, state=filter;void selection.from;void selection.to;if(restoredPage)page=0;else restoredPage=true;});
$effect(()=>{
  const term=search,current=page,state=filter,from=selection.from,to=selection.to,date=today; void revision; if(searchError || invalidPeriod){result={items:[],total:0,page:0,pageSize:25};loading=false;selectedId='';return;}
  const key=`${term}|${current}|${state}|${from}|${to}|${date}`; if(key!==selectionQuery){if(selectionQuery)selectedId='';selectionQuery=key;}
  let cancelled=false; loading=true;
  const timer=setTimeout(()=>{void desktop.searchInvoices(term,current,state,{from,to},date).then(data=>{if(!cancelled){result=data;error='';}}).catch(cause=>{if(!cancelled) error=notify(String(cause), 'error');}).finally(()=>{if(!cancelled) loading=false;});},200);
  return()=>{cancelled=true;clearTimeout(timer);};
});
$effect(()=>{
 const id=selectedId;void detailRevision;selected=null;detailError='';if(!id || selectedKind==='draft' || (selectedKind===undefined && loading))return;
 let cancelled=false;
 void desktop.issued(id).then(data=>{if(!cancelled)selected=data;}).catch(cause=>{if(!cancelled)detailError=notify(String(cause), 'error');});
 return()=>{cancelled=true;};
});
$effect(()=>{
 const id=selectedId;void pdfRevision;pdf='';previewError='';if(!id || selectedKind==='draft' || (selectedKind===undefined && loading)){previewPending=false;return;}
 let cancelled=false;previewPending=true;
 void desktop.readPdf(id).then(bytes=>{if(!cancelled)pdf=bytes;}).catch(cause=>{if(!cancelled)previewError=notify(String(cause), 'error');}).finally(()=>{if(!cancelled)previewPending=false;});
 return()=>{cancelled=true;};
});
onMount(()=>{void desktop.workspace().then(data=>{setup={profile:!!data.profile,customer:data.customerCount>0};}).catch(cause=>error=notify(String(cause),'error'));selectedId=routePage.url.searchParams.get('id')??'';});
beforeNavigate(()=>{const params=new URLSearchParams(periodHref('/invoices',selection,filter).split('?')[1]);if(search)params.set('q',search);if(page)params.set('page',String(page));if(selectedId)params.set('id',selectedId);ledgerMemory.href=`/invoices?${params}`;ledgerMemory.scrollTop=document.querySelector('.ledger .table-scroll')?.scrollTop??0;});
let restoredScroll=false;
$effect(()=>{if(!loading&&!restoredScroll){restoredScroll=true;void tick().then(()=>{const list=document.querySelector('.ledger .table-scroll');if(list)list.scrollTop=ledgerMemory.scrollTop;});}});
let correctionDialog=$state<HTMLDialogElement>(),reason=$state(''),correctionError=$state('');
async function correct(){if(busy||!selected||selected.id!==selectedId)return;correctionError='';if(!reason.trim()){correctionError='Enter a reason for correcting this invoice.';return;}busy=true;try{const id=crypto.randomUUID();await desktop.correctInvoice(selected.id,id,reason);correctionDialog?.close();await goto(`/invoices/edit?id=${id}`);notify('Original invoice voided. Review and issue the replacement draft.');}catch(cause){correctionError=String(cause);}finally{busy=false;}}
function overdue(item:InvoiceSummary){return item.kind==='issued'&&!item.paid&&!item.voidReason&&!!item.dueDate&&item.dueDate<today;}
function daysLate(date:string){return Math.round((Date.parse(today)-Date.parse(date))/86400000);}

async function action(operation:'open'|'save'|'paid') {
 if(busy || !selected || selected.id!==selectedId) return; const item=selected; busy=true;error='';
 try {
  if(operation==='open'){await desktop.openPdf(item.id);notify(`Opened ${item.snapshot.number}.`);}
  else if(operation==='save'){const path=await desktop.savePdf(item.id);notify(path ? `PDF saved to ${path}`:'Save cancelled.', 'success', [], path ?? undefined);}
  else {await desktop.setPaid(item.id,!item.paid);if(selected?.id===item.id) selected={...item,paid:!item.paid};revision++;notify(`${item.snapshot.number} marked ${item.paid?'unpaid':'paid'}.`);}
 }catch(cause){error=notify(String(cause), 'error');}finally{busy=false;}
}
const taxLabels={taxable:'10% GST',gstFree:'GST-free',inputTaxed:'Input taxed',noGst:'No GST'};
const searchError=$derived(fieldErrors(searchSchema,{query:search}).query);
</script>
<svelte:head><title>Invoices</title></svelte:head>
<InvoiceHeader {selection} status={filter}/>
{#if error}<Button type="button" onclick={()=>revision++}>Retry</Button>{/if}

<div class="page-content invoice-content">
{#if setup && (!setup.profile || !setup.customer)}<section class="panel setup-panel" aria-labelledby="setup-title"><h2 id="setup-title">Set up your first invoice</h2><p>Complete your business details, then choose or create a customer in a new draft.</p><div class="actions">{#if !setup.profile}<a class="button primary" href="/profile">Set up business profile</a>{:else}<span class="badge">Business profile ready</span><a class="button primary" href="/invoices/edit">Create your first draft</a>{/if}</div></section>{/if}
<div class:with-detail={!!selectedId} class="ledger">
<section use:rowNavigation={selectRow} data-shortcut-context="list" data-shortcut-label="Invoices" data-shortcut-default class="panel" aria-label="Invoice ledger" aria-busy={loading}>
 <div class="toolbar ledger-toolbar"><Field command="search" id="invoice-search" label="Search invoices" type="search" bind:value={search} error={searchError} submitted/><Field id="payment-filter" label="Invoice status" kind="select" bind:value={filter} options={[{value:'all',label:'All statuses'},{value:'draft',label:'Drafts'},{value:'issued',label:'Issued'},{value:'unpaid',label:'Unpaid'},{value:'paid',label:'Paid'},{value:'overdue',label:'Overdue now'},{value:'void',label:'Voided'},{value:'noDueDate',label:'Unpaid · no due date'}]}/><InvoicePeriod bind:selection bind:today busy={loading} onrefresh={()=>revision++}/></div>
 <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
<section class="table-scroll" aria-label="Invoices table" tabindex="0"><table><thead><tr><th scope="col">Invoice</th><th scope="col">Customer / description</th><th scope="col">Invoice date</th><th scope="col">Due</th><th scope="col" class="numeric">Total AUD</th><th scope="col">Status</th></tr></thead><tbody>
 {#each result.items as item(item.id)}<tr class:selected={selectedId===item.id}><th scope="row">{#if item.kind==='draft'}<a data-row-id={item.id} id={`invoice-${item.id}`} href={`/invoices/edit?id=${encodeURIComponent(item.id)}`} aria-label={`Edit draft for ${item.customerName}`}>Draft</a>{:else}<Button data-row-id={item.id} id={`invoice-${item.id}`} class="link-button" type="button" aria-label={`Preview ${item.number}`} aria-pressed={selectedId===item.id} onclick={event=>void selectInvoice(item.id,event.detail ? event.currentTarget : undefined)}>{item.number}</Button>{/if}</th><td><strong>{item.customerName}</strong><small class="description">{item.description}</small></td><td class="date">{item.date||'Not set'}</td><td class="date" class:overdue={overdue(item)}>{item.dueDate||'Not set'}{#if overdue(item)}<small>{daysLate(item.dueDate??today)} days overdue</small>{/if}</td><td class="numeric">{item.total===null?'—':money(item.total)}</td><td><span class="badge" class:draft={item.kind==='draft'} class:unpaid={item.kind==='issued'&&!item.paid&&!item.voidReason} class:overdue={overdue(item)}>{item.kind==='draft'?'Draft':item.voidReason?'Voided':item.paid?'Paid':overdue(item)?'Overdue':'Unpaid'}</span></td></tr>{/each}
 </tbody></table></section>
 {#if !result.items.length && !error}<div class="empty">{#if invalidPeriod}Choose a valid date range.{:else if loading}Loading invoices…{:else}<h2>{search || filter!=='all' || selection.preset!=='all'?'No matching invoices':'No invoices yet'}</h2><p>{search || filter!=='all' || selection.preset!=='all'?'Try another search, status or date range.':'Create your first draft.'}</p>{/if}</div>{/if}
 <Pagination {...result} busy={loading} onchange={value=>page=value}/>
</section>
{#if selectedId}<aside data-shortcut-context="detail" data-shortcut-label={selectedKind==='draft'?'Draft invoice':'Issued invoice'} class="panel detail-panel" aria-label={selectedKind==='draft'?'Draft invoice':'Issued invoice'}>
 <div class="panel-heading"><h2 id="invoice-details-heading" tabindex="-1">{selectedKind==='draft'?'Draft':selected?.snapshot.number ?? 'Issued invoice'}</h2><Button data-command="close" type="button" aria-label="Close invoice details" onclick={()=>void closeDetails()}>Close</Button></div>
 <div class="detail-body">
 {#if selectedKind==='draft'}<p class="empty">Draft — press Enter to edit</p><a class="button" href={`/invoices/edit?id=${encodeURIComponent(selectedId)}`}>Edit draft</a>{:else}
 {#if detailError}<Button type="button" onclick={()=>detailRevision++}>Retry details</Button>{:else if !selected}<p role="status">Loading invoice details…</p>{/if}
 {#if selected}<div class="detail-actions"><span class="badge" class:unpaid={!selected.paid}>{selected.voidReason?'Voided':selected.paid?'Paid':'Unpaid'}</span><strong>{money(selected.snapshot.totals.total)}</strong><div class="actions"><Button type="button" disabled={busy} data-command="openPdf" onclick={()=>action('open')} aria-label={`Open PDF ${selected.snapshot.number}`}>Open PDF</Button><Button type="button" disabled={busy} data-command="savePdf" onclick={()=>action('save')} aria-label={`Save PDF ${selected.snapshot.number}`}>Save PDF</Button><span class="payment-action">{#if !selected.voidReason}<Button class="primary" type="button" disabled={busy} data-command="togglePaid" onclick={()=>action('paid')} aria-label={`Mark ${selected.snapshot.number} ${selected.paid?'unpaid':'paid'}`}>Mark {selected.paid?'unpaid':'paid'}</Button>{/if}</span></div></div>{/if}
 <fieldset class="section-tabs detail-tabs" aria-label="Invoice view"><Button type="button" aria-pressed={tab==='pdf'} onclick={()=>selectTab('pdf')}>PDF</Button><Button type="button" aria-pressed={tab==='data'} onclick={()=>selectTab('data')}>Invoice details</Button></fieldset>
 {#if selected?.voidReason}<p class="void-notice">Voided: {selected.voidReason}. Excluded from invoice totals. The PDF below is the original document.</p>{:else}<div class="issued-note"><span class="note">Issued · read-only</span><Button type="button" class="link-button" disabled={!selected||busy} onclick={()=>{reason='';correctionError='';correctionDialog?.showModal();}}>Correct invoice</Button></div>{/if}
 {#if previewError}<Button type="button" onclick={()=>pdfRevision++}>Retry preview</Button>{/if}
 {#if tab==='pdf'}{#if !previewError}{#key selectedId}<PdfPreview {pdf} pending={previewPending} label={selected?.snapshot.number ?? 'Invoice preview'} message={previewError || 'Loading saved PDF…'}/>{/key}{/if}{:else if selected}{@const s=selected.snapshot}
 <div class="snapshot-data"><h3>{s.heading} · {s.draft.date}</h3><dl><dt>Supplier</dt><dd>{s.profile.name}<br/>{s.profile.abn ? `ABN ${displayValue(s.profile.abn, 'abn')}` : ''}<br/>{s.profile.address}</dd><dt>Customer</dt><dd>{s.customer.name || displayValue(s.customer.abn, 'abn')} ({s.customer.code})<br/>{s.customer.abn ? `ABN ${displayValue(s.customer.abn, 'abn')}` : ''}<br/>{s.customer.address}{#if s.customer.attention}<br/>Attention: {s.customer.attention}{/if}</dd>{#if s.draft.reference}<dt>Reference/P.O.</dt><dd>{s.draft.reference}</dd>{/if}{#if s.dueDate}<dt>Due date</dt><dd>{s.dueDate}</dd>{/if}</dl>
 {#each s.draft.lines as line,index}<div class="snapshot-line"><strong>{line.description}</strong><small>{displayValue(line.quantity, 'quantity')} × ${displayValue(line.unitPrice, 'money')} · {taxLabels[line.tax]}</small><span>{money(s.totals.lines[index]?.total ?? 0)}</span></div>{/each}
 <dl><dt>Subtotal</dt><dd>{money(s.totals.net)}</dd><dt>GST</dt><dd>{money(s.totals.gst)}</dd><dt>Total AUD</dt><dd><strong>{money(s.totals.total)}</strong></dd><dt>Payment details</dt><dd>{#each s.profile.paymentMethods ?? [] as method}{@const payment=paymentText(method,s.draft.bpayReference)}<strong>{payment.label}</strong><br/>{payment.value}<br/>{/each}{s.profile.paymentDetails}</dd><dt>Notes</dt><dd>{s.draft.notes || '—'}</dd></dl></div>{/if}

 {/if}</div></aside>{/if}
</div>
</div>
<dialog bind:this={correctionDialog} data-shortcut-context="dialog" aria-labelledby="correct-title" oncancel={event=>{if(busy)event.preventDefault();}}><form onsubmit={event=>{event.preventDefault();void correct();}}><fieldset disabled={busy}><h2 id="correct-title">Correct {selected?.snapshot.number}?</h2><p>The original will be marked void and excluded from totals. Its PDF remains unchanged. A replacement draft will receive a new number when issued.</p>{#if selected?.paid}<p class="note">This invoice was marked paid. Correcting it does not record a refund or transfer a payment; review the replacement's payment status separately.</p>{/if}<Field id="correction-reason" label="Reason for correction" bind:value={reason} required error={correctionError} submitted/><div class="form-actions"><Button type="button" onclick={()=>correctionDialog?.close()}>Keep original</Button><Button type="submit" class="danger primary">Void and create replacement</Button></div></fieldset></form></dialog>
<style>table{min-width:calc(560rem / 13)}td strong{overflow-wrap:anywhere}th :global(.link-button){white-space:nowrap}
.ledger{display:grid;gap:calc(12rem / 13)}.with-detail{grid-template-columns:minmax(0,1fr) clamp(calc(340rem / 13),calc(100% - calc(850rem / 13)),calc(740rem / 13))}.description{max-width:calc(430rem / 13);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.date{white-space:nowrap}.detail-panel{align-self:start;min-width:0;--pdf-preview-max-height:none}.detail-body{padding:calc(12rem / 13)}.detail-tabs{margin-top:calc(12rem / 13)}.detail-actions{display:flex;flex-wrap:wrap;justify-content:space-between;gap:calc(8rem / 13);margin-bottom:calc(12rem / 13)}.detail-actions>.actions{width:100%;gap:calc(4rem / 13)}.payment-action{display:inline-flex;border-left:1px solid var(--line-strong);padding-left:calc(8rem / 13);margin-left:calc(4rem / 13)}.detail-actions :global(button){padding-inline:calc(7rem / 13)}.snapshot-data{font-size:calc(12rem / 13)}.snapshot-data dl{display:grid;grid-template-columns:calc(80rem / 13) minmax(0,1fr);gap:calc(8rem / 13);margin:0 0 calc(12rem / 13)}.snapshot-data dt{color:var(--muted)}.snapshot-data dd{margin:0;white-space:pre-line;overflow-wrap:anywhere}.snapshot-line{display:grid;gap:calc(4rem / 13);border-block-start:1px solid var(--line);padding:calc(8rem / 13) 0;overflow-wrap:anywhere;white-space:pre-line}.snapshot-line span{text-align:right}
@container app (max-width: calc(1099rem / 13)){.with-detail{grid-template-columns:minmax(0,1fr)}.detail-panel{grid-row:1}.detail-body{max-width:none}.detail-panel :global(.pdf-preview){max-width:calc(680rem / 13);margin:auto}.description{max-width:calc(220rem / 13)}}
@container app (max-width: calc(620rem / 13)){.description{max-width:10rem}.detail-body{max-width:100%}}


.ledger-toolbar{flex-wrap:wrap}.ledger-toolbar>:global(.admin-field:first-child){flex:1 1 calc(180rem / 13)}.ledger-toolbar>:global(.invoice-filters){flex:0 1 auto;max-width:100%;min-width:0}.ledger-toolbar :global(.filter-row){flex-wrap:wrap}.ledger-toolbar :global(.period-controls){flex:1}.ledger-toolbar :global(.period-controls .admin-field){flex:1;min-width:calc(150rem / 13)}.overdue,.overdue small{color:var(--danger)}.badge.overdue{background:var(--danger-soft)}.issued-note{display:flex;justify-content:space-between;align-items:center;margin-block:calc(8rem / 13)}.void-notice{padding:calc(10rem / 13);background:var(--danger-soft);color:var(--danger)}.setup-panel{padding:calc(16rem / 13)}.setup-panel p{margin-bottom:calc(8rem / 13)}.setup-panel h2{margin-bottom:calc(6rem / 13)}
</style>
