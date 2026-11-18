<script lang="ts">
import { onMount, tick } from 'svelte';
import { goto, replaceState } from '$app/navigation';
import Breadcrumbs from '../../../lib/components/Breadcrumbs.svelte';
import CustomerFields from '../../../lib/components/CustomerFields.svelte';
import Icon from '../../../lib/components/Icon.svelte';
import PdfPreview from '../../../lib/components/PdfPreview.svelte';
import ServiceFields from '../../../lib/components/ServiceFields.svelte';
import UnsavedChanges from '../../../lib/components/UnsavedChanges.svelte';
import { Button, Field, RecordCombobox } from '../../../lib/components/ui';
import { desktop, money } from '../../../lib/desktop';
import type { Customer, Draft, Profile, Service, Snapshot } from '../../../lib/domain/types';
import {displayValue} from '../../../lib/format';
import { ledgerMemory } from '../../../lib/ledger-memory.svelte';
import { notify } from '../../../lib/notifications';
import { customerSchema, draftSchema, fieldErrors, focusInvalid, savedDraftSchema, serviceSchema } from '../../../lib/validation';

let profile = $state<Profile | null>(null);
let customers = $state<Customer[]>([]);
let persisted = $state(false);
let previewFailed=$state(false),previewRevision=$state(0);
let editorView=$state<'edit'|'preview'>('edit');
let draft = $state<Draft>({ id:'', customerId:'', date:'', notes:'', reference:'', bpayReference:'', due:{mode:'relative',amount:1,unit:'months'}, lines:[] });
let snapshot = $state<Snapshot | null>(null);
let pdf = $state('');
let previewMessage = $state('Add your invoice details to see a live PDF.');
let previewPending = $state(false);
let loaded = $state(false);
let savedJson = $state('');
let fatal = $state(false);
let busy = $state(false);
let issueDialog = $state<HTMLDialogElement>();
let form = $state<HTMLFormElement | null>(null);
let submitted = $state(false),savingIncomplete=$state(false);
const hasBpay = $derived(profile?.paymentMethods?.some(method=>method.type==='bpay') ?? false);
const issueErrors = $derived(fieldErrors(draftSchema(customers, profile?.gstRegistered ?? false, hasBpay), draft));
const saveErrors=$derived(fieldErrors(savedDraftSchema,draft));
const errors=$derived(savingIncomplete?saveErrors:issueErrors);
const ready = $derived(loaded && !fatal && profile !== null);
const dirty = $derived(loaded && JSON.stringify(draft) !== savedJson);
const canSave = $derived(ready && dirty && !busy);
const selectedCustomer = $derived(customers.find(c => c.id === draft.customerId));


$effect(() => {
  const value = JSON.parse(JSON.stringify(draft)) as Draft;
  void previewRevision;
  if(!ready) return;
  const validation = fieldErrors(draftSchema(customers, profile?.gstRegistered ?? false, hasBpay), value);
  if (Object.keys(validation).length) { previewFailed=true; previewPending = false; previewMessage = 'Complete the customer, date and items to preview this draft.'; return; }
  let cancelled = false;
  previewPending = true; previewFailed=false;
  const timer = setTimeout(() => {
    void desktop.previewDraft(value).then(result => { if(!cancelled) { snapshot = result.snapshot; pdf = result.pdf; previewMessage = ''; } }).catch(cause => { if(!cancelled) { notify(String(cause), 'error'); previewFailed=true;previewMessage = 'Preview unavailable. Retry when ready.'; } }).finally(() => { if(!cancelled) previewPending = false; });
  }, 400);
  return () => { cancelled = true; clearTimeout(timer); };
});
onMount(() => { void load(); });
async function load() {
  try {
    fatal=false;loaded=false;const data = await desktop.workspace(); profile = data.profile;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    persisted=!!id;
    if(id) { const saved = await desktop.draft(id); draft = {reference:'', bpayReference:'',due:{mode:'none'},...saved}; }
    else { const today = new Date(); draft = { id:crypto.randomUUID(), customerId:params.get('customer') ?? '', date:`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`, notes:'', reference:'', bpayReference:'', due:{mode:'relative',amount:1,unit:'months'}, lines:[{ description:'', quantity:'1', unitPrice:'0.00', tax:profile?.gstRegistered ? 'taxable' : 'noGst' }] }; }
    if(draft.customerId) customers = [(await desktop.customer(draft.customerId)).customer];
    savedJson = JSON.stringify(draft);
  } catch(cause) { notify(String(cause), 'error'); fatal = true; } finally { loaded = true; }
}
function selectService(index:number, service:Service) {
  const line=draft.lines[index];if(!line)return;
  draft.lines[index]={service:{id:service.id,name:service.name},description:service.description,quantity:line.quantity,unitPrice:service.unitPrice,tax:service.tax};
}
let serviceDialog=$state<HTMLDialogElement>();
let serviceForm=$state<HTMLFormElement|null>(null);
let serviceRow=0;let variation=$state(false);
let newService=$state<Service>({id:'',name:'',description:'',unitPrice:'0.00',tax:'taxable'});
let serviceSubmitted=$state(false),serviceBusy=$state(false);
const serviceErrors=$derived(fieldErrors(serviceSchema,newService));
function createService(index:number, query:string){
 variation=false;serviceRow=index;const line=draft.lines[index];
 newService={id:crypto.randomUUID(),name:query.slice(0,200),description:query || line?.description || '',unitPrice:line?.unitPrice || '0.00',tax:profile?.gstRegistered?'taxable':'noGst'};
 serviceSubmitted=false;serviceDialog?.showModal();
}
function adaptService(index:number){
 const line=draft.lines[index];if(!line?.service)return;
 variation=true;serviceRow=index;
 newService={id:crypto.randomUUID(),name:`${line.service.name.slice(0,186)} (variation)`,description:line.description,unitPrice:line.unitPrice,tax:line.tax};
 serviceSubmitted=false;serviceDialog?.showModal();
}
let customerDialog=$state<HTMLDialogElement>(),customerForm=$state<HTMLFormElement|null>(null);
let newCustomer=$state<Customer>({id:'',name:'',code:'',abn:'',attention:'',address:'',nextNumber:1});
let customerSubmitted=$state(false),customerBusy=$state(false),customerCodeError=$state('');
const customerErrors=$derived({...fieldErrors(customerSchema([],null),newCustomer),...(customerCodeError?{code:customerCodeError}:{})});
function createCustomer(query:string){newCustomer={id:crypto.randomUUID(),name:query,code:'',abn:'',attention:'',address:'',nextNumber:1};customerSubmitted=false;customerCodeError='';customerDialog?.showModal();}
async function saveCustomer(event:SubmitEvent){
 event.preventDefault();if(customerBusy)return;customerSubmitted=true;customerCodeError='';
 if(Object.keys(fieldErrors(customerSchema([],null),newCustomer)).length){focusInvalid(customerForm);return;}
 customerBusy=true;
 try{if(!await desktop.customerCodeAvailable(newCustomer.code,newCustomer.id)){customerCodeError='This customer code is already in use.';focusInvalid(customerForm);return;}
 await desktop.saveCustomer($state.snapshot(newCustomer));customers=[$state.snapshot(newCustomer)];draft.customerId=newCustomer.id;draft.bpayReference='';customerDialog?.close();await tick();document.getElementById('invoice-date')?.focus();}
 catch(cause){notify(String(cause),'error');}finally{customerBusy=false;}
}
let deleteDialog=$state<HTMLDialogElement>();
async function deleteDraft(){if(busy)return;busy=true;try{await desktop.deleteDraft(draft.id);savedJson=JSON.stringify(draft);deleteDialog?.close();await goto(ledgerMemory.href);notify('Draft deleted.');}catch(cause){notify(String(cause),'error');}finally{busy=false;}}
async function saveService(event:SubmitEvent){
 event.preventDefault();if(serviceBusy)return;serviceSubmitted=true;
 if(Object.keys(serviceErrors).length){focusInvalid(serviceForm);return;}
 serviceBusy=true;
 try{await desktop.saveService($state.snapshot(newService));selectService(serviceRow,$state.snapshot(newService));serviceDialog?.close();queueMicrotask(()=>document.getElementById(`quantity-${serviceRow}`)?.focus());}
 catch(cause){notify(String(cause), 'error');}finally{serviceBusy=false;}
}
const taxLabels={taxable:'10%',gstFree:'GST-free',inputTaxed:'Input taxed',noGst:'No GST'};
function setDueMode(mode:string) {
  draft.due = mode === 'exact' ? {mode:'exact',date:snapshot?.dueDate || draft.date} : mode === 'relative' ? {mode:'relative',amount:1,unit:'months'} : {mode:'none'};
}
async function addLine() { if(draft.lines.length >= 200)return; draft.lines.push({ description:'', quantity:'1', unitPrice:'0.00', tax:profile?.gstRegistered ? 'taxable' : 'noGst' }); await tick(); document.getElementById(`service-${draft.lines.length-1}`)?.focus(); }
async function save(action: 'save' | 'pdf' | 'issue') {
  if(busy || !ready || (action === 'save' && !canSave)) return;
  savingIncomplete=action==='save';submitted=true;
  if(Object.keys(action==='save'?saveErrors:issueErrors).length) { focusInvalid(form); return; }
  busy = true; 
  try {
    await desktop.saveDraft($state.snapshot(draft)); savedJson = JSON.stringify(draft);persisted=true;replaceState(`/invoices/edit?id=${encodeURIComponent(draft.id)}`,{}); notify(Object.keys(issueErrors).length?'Draft saved. Finish the missing details before issuing.':'Draft saved.');
    if(action === 'issue') { await desktop.issue(draft.id); await goto(`/invoices?id=${encodeURIComponent(draft.id)}`); }
    else if(action === 'pdf') await desktop.openPdf(draft.id, true);
  } catch(cause) { notify(String(cause), 'error'); } finally { busy = false; await tick(); issueDialog?.close(); }
}
async function requestIssue() { if(busy || previewPending)return; savingIncomplete=false;submitted = true; if(Object.keys(errors).length) { focusInvalid(form); return; } await tick(); issueDialog?.showModal(); document.getElementById('issue-confirmation')?.focus(); }
async function removeLine(index:number){draft.lines.splice(index,1);await tick();document.getElementById(`service-${Math.min(index,draft.lines.length-1)}`)?.focus();}
</script>
<svelte:head><title>Draft</title></svelte:head>
<UnsavedChanges {dirty} />
<div class="page-heading"><Breadcrumbs current="Draft" parent={{href:ledgerMemory.href,label:'Invoices'}}/><span class="badge draft">{dirty ? 'Unsaved changes' : 'Draft'}</span></div>

{#if !loaded}<p role="status">Loading draft…</p>{/if}{#if fatal}<Button type="button" onclick={load}>Retry loading draft</Button>{/if}
{#if loaded && !fatal && !profile}<div class="panel empty"><h2>Start with your business details</h2><p>Your supplier information is needed on every invoice.</p><a class="button primary" href="/profile">Set up business profile</a></div>{/if}
{#if ready}
<fieldset class="editor-view-tabs section-tabs" aria-label="Draft view"><Button type="button" aria-pressed={editorView==='edit'} onclick={()=>editorView='edit'}>Edit invoice</Button><Button type="button" aria-pressed={editorView==='preview'} onclick={()=>editorView='preview'}>Preview</Button></fieldset>
<div class="page-content split editor-layout" class:show-preview={editorView==='preview'}>
 <form data-shortcut-context="editor" data-shortcut-label="Draft" data-shortcut-default class="panel panel-body invoice-editor" novalidate bind:this={form} onsubmit={event=>{event.preventDefault();void save('save');}} aria-busy={busy}>
 <fieldset disabled={busy}>
 {#if submitted && Object.keys(errors).length}<p class="form-error" role="alert">Check the highlighted fields.</p>{/if}
  <div class="invoice-meta"><RecordCombobox id="customer" label="Customer" noun="customer" itemLabel={item=>item.name||displayValue(item.abn, 'abn')} disabled={busy} value={selectedCustomer ? `${selectedCustomer.name || displayValue(selectedCustomer.abn, 'abn')} (${selectedCustomer.code})` : ''} loader={desktop.searchCustomers} oncreate={createCustomer} onselect={item=>{if(draft.customerId!==item.id) draft.bpayReference='';customers=[item];draft.customerId=item.id;}} error={submitted?errors.customerId:''}/><Field id="invoice-date" label="Invoice date" type="date" bind:value={draft.date} error={errors.date} {submitted} required/></div>
  <div class="form-grid invoice-terms">
   <Field id="invoice-reference" label="Reference/P.O." bind:value={draft.reference} error={errors.reference} {submitted}/>
   {#if hasBpay || draft.bpayReference}<Field id="bpay-reference" label="BPAY reference (CRN)" format="digits" bind:value={draft.bpayReference} error={errors.bpayReference} {submitted} required={hasBpay} inputmode="numeric" hint={hasBpay ? "2–20 digits from your bank-approved reference scheme. Keep any leading zeroes." : "BPAY is disabled in your profile. Clear this reference to continue."}/>{/if}
   <Field id="due-mode" label="Due date" kind="select" bind:value={() => draft.due?.mode ?? 'none', setDueMode} options={[{value:'relative',label:'Relative to invoice date'},{value:'exact',label:'Exact date'},{value:'none',label:'No due date'}]}/>
   {#if draft.due?.mode === 'exact'}
    <Field id="due-exact" label="Exact due date" type="date" bind:value={draft.due.date} error={errors['due.date']} {submitted} required/>
   {:else if draft.due?.mode === 'relative'}
    <Field id="due-offset" label="Due after" bind:value={() => draft.due?.mode==='relative' && Number.isFinite(draft.due.amount) ? String(draft.due.amount) : '', value => {if(draft.due?.mode==='relative') draft.due.amount=value.trim()?Number(value):Number.NaN;}} inputmode="numeric" error={errors['due.amount']} {submitted} required/>
    <Field id="due-unit" label="Due date unit" kind="select" bind:value={draft.due.unit} options={[{value:'days',label:'Days'},{value:'months',label:'Calendar months'}]}/>
   {/if}
  </div>
  {#if selectedCustomer?.attention}<p class="note">Attention: {selectedCustomer.attention}</p>{/if}
  <div class="due-summary">{#if snapshot?.dueDate}<p class="note">Payment due {snapshot.dueDate.split('-').reverse().join('/')}</p>{/if}{#if draft.due?.mode === 'relative'}<p class="note">After the invoice date; month-end dates use the last valid day.</p>{/if}</div>
  <section class="line-items" aria-label="Invoice items">
   <div class="line-grid column-labels" aria-hidden="true"><span>Service</span><span class="numeric">Qty</span><span class="numeric">Unit ex GST</span><span class="numeric">GST</span><span class="numeric">Total AUD</span><span></span></div>
   {#each draft.lines as item,index(index)}
    <div class="line-grid invoice-line">
     <div class="service-cell"><RecordCombobox noun="service" compact loader={desktop.searchServices} trailing={service=>money(Math.round(Number(service.unitPrice)*100))} id={`service-${index}`} label={`Service ${index+1}`} value={item.service ? item.service.name : ''} error={submitted?(errors[`lines.${index}.service`]||errors[`lines.${index}.tax`]||''):''} onselect={service=>selectService(index,service)} oncreate={query=>createService(index,query)} disabled={busy}/>{#if item.service}<Button class="link-button adapt-service" type="button" aria-label={`Adapt service ${index+1}`} onclick={()=>adaptService(index)}>Edit price / description</Button>{/if}{#if item.description && item.description!==item.service?.name}<small class="line-description">{item.description}</small>{/if}</div>
     <Field id={`quantity-${index}`} label={`Quantity ${index+1}`} format="quantity" bind:value={item.quantity} error={errors[`lines.${index}.quantity`]} {submitted} inputmode="decimal" compact required/>
     <output data-caption="Unit ex GST" class="numeric line-value" aria-label={`Unit price ${index+1} (AUD)`}>{item.service?money(Math.round(Number(item.unitPrice)*100)):'—'}</output>
     <span data-caption="GST" class="numeric line-value"><span class="sr-only">GST classification {index+1}: </span>{item.service?taxLabels[item.tax]:'—'}</span>
     <strong data-caption="Total AUD" class="numeric line-value"><span class="sr-only">Total {index+1} (AUD): </span>{snapshot?money(snapshot.totals.lines[index]?.total??0):'—'}</strong>
     <Button class="quiet danger remove-line" type="button" aria-label={`Remove line ${index+1}`} disabled={draft.lines.length<=1} onclick={()=>void removeLine(index)}><Icon name="close" size={14}/></Button>
    </div>
   {/each}
   <Button data-command="addLine" class="quiet add-line" type="button" disabled={draft.lines.length>=200} onclick={addLine}><Icon name="plus" size={14}/>Add service</Button>
  </section>
  {#if (previewPending || previewFailed) && snapshot}<p class="note" role="status">{previewPending?'Updating preview - amounts below are from the last valid preview.':'Finish the incomplete items to update the amounts below.'}</p>{/if}
  <div class="notes-totals"><Field id="notes" label="Notes" kind="textarea" bind:value={draft.notes} error={errors.notes} {submitted} rows={2}/><div class="totals" aria-live="polite"><div><span>Subtotal</span><span>{snapshot?money(snapshot.totals.net):'—'}</span></div><div><span>GST</span><span>{snapshot?money(snapshot.totals.gst):'—'}</span></div><div class="grand-total"><strong>Total AUD</strong><strong data-testid="draft-total">{snapshot?money(snapshot.totals.total):'—'}</strong></div></div></div>
  <div class="editor-actions">{#if persisted}<Button class="quiet danger" type="button" onclick={()=>deleteDialog?.showModal()}>Delete draft</Button>{/if}<Button type="button" disabled={busy||!snapshot} data-command="openPdf" onclick={()=>void save('pdf')}>Open draft PDF</Button><div class="actions"><Button data-command="save" class="save-button" type="submit" disabled={!canSave}>Save draft</Button><Button data-command="issue" id="issue-invoice" class="primary" type="button" disabled={busy||previewPending} onclick={()=>{if(previewFailed&&!Object.keys(issueErrors).length){previewRevision++;return;}void requestIssue();}}>Issue invoice</Button></div></div>
 </fieldset></form>
 <aside class="panel panel-body invoice-preview"><PdfPreview {pdf} stale={previewFailed} pending={previewPending} label="Live invoice preview" message={previewMessage}/>{#if previewFailed && !Object.keys(issueErrors).length}<Button type="button" onclick={()=>previewRevision++}>Retry preview</Button>{/if}</aside>
</div>
{/if}
<dialog bind:this={issueDialog} data-shortcut-context="dialog" aria-labelledby="issue-confirmation" aria-busy={busy} onclose={()=>document.getElementById('issue-invoice')?.focus()} oncancel={event=>{if(busy)event.preventDefault();}}><h2 id="issue-confirmation" tabindex="-1">Issue {snapshot?money(snapshot.totals.total):''}?</h2><p>Issue to <strong>{selectedCustomer?.name || displayValue(selectedCustomer?.abn ?? '', 'abn')}</strong>. Invoice details and the PDF cannot be edited after issue.</p><div class="actions"><Button data-command="close" type="button" disabled={busy} onclick={()=>issueDialog?.close()}>Cancel issue</Button><Button class="primary" type="button" disabled={busy} onclick={()=>void save('issue')}>Confirm issue</Button></div></dialog>
<dialog data-shortcut-context="dialog" class="service-dialog" bind:this={serviceDialog} aria-labelledby="create-service-title" oncancel={event=>{if(serviceBusy)event.preventDefault();}}>
 <form novalidate bind:this={serviceForm} onsubmit={saveService}><fieldset disabled={serviceBusy}><h2 id="create-service-title">{variation?'Adapt service':'Create service'}</h2>{#if variation}<p>Save this price and description as a new reusable service. The original service stays unchanged.</p>{/if}<ServiceFields bind:service={newService} errors={serviceErrors} submitted={serviceSubmitted} prefix="new-service"/><div class="dialog-actions"><Button data-command="close" type="button" onclick={()=>serviceDialog?.close()}>Cancel</Button><Button data-command="save" class="primary" type="submit">{variation?'Save variation and select':'Create and select'}</Button></div></fieldset></form>
</dialog>
<dialog bind:this={customerDialog} data-shortcut-context="dialog" aria-labelledby="new-customer-title" oncancel={event=>{if(customerBusy)event.preventDefault();}}><form bind:this={customerForm} novalidate onsubmit={saveCustomer}><fieldset disabled={customerBusy}><h2 id="new-customer-title">Create customer</h2><CustomerFields bind:customer={newCustomer} errors={customerErrors} submitted={customerSubmitted} prefix="new-customer"/><div class="form-actions"><Button type="button" data-command="close" onclick={()=>customerDialog?.close()}>Cancel</Button><Button class="primary" type="submit" data-command="save">Create customer and select</Button></div></fieldset></form></dialog>
<dialog bind:this={deleteDialog} data-shortcut-context="dialog" aria-labelledby="delete-draft-title" oncancel={event=>{if(busy)event.preventDefault();}}><h2 id="delete-draft-title">Delete this draft?</h2><p>The saved draft and unsaved changes will be removed. No issued invoice is affected.</p><div class="actions"><Button type="button" disabled={busy} onclick={()=>deleteDialog?.close()}>Keep draft</Button><Button class="danger primary" type="button" disabled={busy} onclick={deleteDraft}>Delete draft permanently</Button></div></dialog>
<style>
.editor-layout{grid-template-columns:minmax(0,1fr) clamp(calc(300rem / 13),calc(100% - calc(850rem / 13)),calc(740rem / 13));gap:calc(12rem / 13)}.invoice-preview{align-self:start;min-width:0;--pdf-preview-max-height:max(calc(160rem / 13),calc(100dvh - 20rem))}
.invoice-meta{display:grid;grid-template-columns:minmax(0,1fr) calc(160rem / 13);gap:calc(8rem / 13);margin-bottom:calc(8rem / 13)}
.invoice-terms{grid-template-columns:1.4fr 1.5fr .7fr 1.2fr;margin-bottom:calc(12rem / 13)}
.line-grid{display:grid;grid-template-columns:minmax(calc(140rem / 13),1fr) calc(56rem / 13) calc(82rem / 13) calc(68rem / 13) calc(82rem / 13) calc(32rem / 13);gap:calc(8rem / 13);align-items:start}
.column-labels{font-size:calc(12rem / 13);color:var(--muted);padding:0 0 calc(8rem / 13);border-bottom:1px solid var(--line)}
.invoice-line{padding:calc(4rem / 13) 0;border-bottom:1px solid var(--line)}
.service-cell{min-width:0}.line-description{display:block;white-space:pre-line;overflow-wrap:anywhere;margin-top:calc(4rem / 13);font-size:calc(12rem / 13);line-height:1.4}
.invoice-line :global(.field-control){height:calc(32rem / 13);min-height:calc(32rem / 13)}.line-value{font-size:calc(12rem / 13);line-height:calc(32rem / 13)}.invoice-line :global(.remove-line){padding:0;height:calc(32rem / 13);min-height:calc(32rem / 13);width:calc(32rem / 13);border:0}
.line-items :global(.add-line){margin:calc(4rem / 13) 0 calc(12rem / 13);padding-left:0}
.notes-totals{display:grid;grid-template-columns:minmax(0,1fr) calc(200rem / 13);gap:calc(20rem / 13)}.totals{font-size:calc(12rem / 13)}.totals>div{display:flex;justify-content:space-between;padding:calc(3rem / 13) 0;font-variant-numeric:tabular-nums}.totals>.grand-total{border-top:1px solid var(--line);margin-top:calc(4rem / 13);padding-top:calc(8rem / 13)}
.due-summary:empty{display:none}.due-summary{margin:calc(8rem / 13) 0 calc(12rem / 13)}.due-summary p{margin:0}.editor-actions{display:flex;justify-content:space-between;flex-wrap:wrap;gap:calc(8rem / 13);border-top:1px solid var(--line);margin-top:calc(12rem / 13);padding-top:calc(12rem / 13)}
.service-dialog{width:min(calc(460rem / 13),95vw)}.dialog-actions{display:flex;gap:calc(8rem / 13);margin-top:calc(16rem / 13)}
@container app (max-width: calc(1200rem / 13)){.editor-layout{grid-template-columns:minmax(0,1fr) calc(240rem / 13);gap:calc(12rem / 13)}.invoice-terms{grid-template-columns:repeat(2,minmax(0,1fr))}.line-grid{grid-template-columns:minmax(calc(125rem / 13),1fr) calc(44rem / 13) calc(70rem / 13) calc(58rem / 13) calc(70rem / 13) calc(32rem / 13);gap:calc(4rem / 13)}.notes-totals{grid-template-columns:minmax(0,1fr) calc(160rem / 13);gap:calc(12rem / 13)}}
.editor-view-tabs{display:none}:global(.adapt-service){font-size:calc(12rem / 13);min-height:calc(24rem / 13)}.form-error{color:var(--danger)}
@container app (max-width: calc(999rem / 13)){.editor-view-tabs{display:flex}.editor-layout:not(.show-preview) .invoice-preview{display:none}.editor-layout.show-preview .invoice-editor{display:none}.editor-layout.show-preview .invoice-preview{width:100%;max-width:calc(720rem / 13);justify-self:center;--pdf-preview-max-height:none}.editor-layout{grid-template-columns:minmax(0,1fr)}}
@container app (max-width: calc(620rem / 13)){.invoice-terms{grid-template-columns:minmax(0,1fr)}.invoice-meta,.notes-totals{grid-template-columns:minmax(0,1fr)}.column-labels{display:none}.line-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:calc(8rem / 13)}.service-cell{grid-column:1 / 4}.invoice-line :global(.remove-line){grid-column:4;grid-row:1;justify-self:end}.invoice-line :global(.admin-field.compact:not(.record-combobox) .field-control > label){position:static;width:auto;height:auto;clip-path:none;white-space:nowrap;padding:1px calc(6rem / 13) 0;flex-basis:1rem;font-size:calc(12rem / 13);line-height:calc(12rem / 13)}.invoice-line :global(.admin-field.compact:not(.record-combobox) input){padding:1px calc(6rem / 13);line-height:calc(16rem / 13)}.invoice-line>:global(.admin-field){grid-column:1;grid-row:2}.invoice-line>output{grid-column:2}.invoice-line>span.line-value{grid-column:3}.invoice-line>strong.line-value{grid-column:4}.invoice-line>.line-value{grid-row:2;white-space:normal;overflow-wrap:anywhere;line-height:calc(20rem / 13)}.line-value::before{content:attr(data-caption);display:block;color:var(--muted);font-size:calc(12rem / 13);font-weight:400;line-height:calc(17rem / 13)}.notes-totals{gap:calc(12rem / 13)}.invoice-preview{justify-self:start}}
</style>
