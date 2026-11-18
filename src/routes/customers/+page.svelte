<script lang="ts">
import { onMount } from 'svelte';
import Breadcrumbs from '../../lib/components/Breadcrumbs.svelte';
import CustomerFields from '../../lib/components/CustomerFields.svelte';
import Icon from '../../lib/components/Icon.svelte';
import UnsavedChanges from '../../lib/components/UnsavedChanges.svelte';
import { Button, Field, Pagination } from '../../lib/components/ui';
import { desktop } from '../../lib/desktop';
import type { Customer, Page } from '../../lib/domain/types';
import {displayValue} from '../../lib/format';
import { notify } from '../../lib/notifications';
import { focusRecord, rowNavigation } from '../../lib/row-navigation';
import {customerSchema, fieldErrors, focusInvalid, searchSchema } from '../../lib/validation';

let data = $state<Page<Customer> | null>(null);
let page = $state(0);
let listing = $state(false);
let listError = $state(''), revision = $state(0);
function focusEditor(row?:HTMLElement) { return focusRecord('customer-name',row); }
let codeLocked = $state(false);
let codeError = $state('');
let customer = $state<Customer>({
  id: '',
  code: '',
  name: '',
  attention: '',
  abn: '',
  address: '',
  nextNumber: 1,
});
let busy = $state(true);
let readingId = $state(''), readVersion = 0;
let search = $state('');
let savedJson = $state('');
let submitted = $state(false);
let editingId = $state<string | null>(null);
let form = $state<HTMLFormElement | null>(null);
const errors = $derived(fieldErrors(customerSchema([], editingId), customer));
const dirty = $derived(data !== null && !readingId && JSON.stringify(customer) !== savedJson);
const canSave = $derived(dirty && !busy);
const matches = $derived(data?.items ?? []);
$effect(() => { const term=search; if(term !== undefined) page=0; });
$effect(() => {
  const term=search, current=page; void revision; if(searchError){data={items:[],total:0,page:0,pageSize:25};listing=false;return;} let cancelled=false;listing=true;
  const timer=setTimeout(()=>{void desktop.searchCustomers(term,current).then(result=>{if(!cancelled) { data=result; listError=''; }}).catch(cause=>{if(!cancelled) listError=notify(String(cause), 'error');}).finally(()=>{if(!cancelled) listing=false;});},200);
  return ()=>{cancelled=true;clearTimeout(timer);};
});
$effect(() => { const code=customer.code; if(code) codeError=''; });
let switchDialog = $state<HTMLDialogElement>();
let pendingCustomer: Customer | null = null;
let pendingRow: HTMLElement | undefined;
function select(item: Customer | null, row?:HTMLElement) {
  if (busy) return;
  if (item && item.id === (readingId || editingId)) { if(!readingId) void focusEditor(row); return; }
  if (dirty) { pendingCustomer = item; pendingRow = row; switchDialog?.showModal(); }
  else if (item) void edit(item,row); else { create(); void focusEditor(); }
}
function selectRow(id:string,row:HTMLElement) { const item=matches.find(item=>item.id===id);if(item)select(item,row); }
function keepEditing() { switchDialog?.close();if(pendingRow){const row=pendingRow.closest('tbody')?.querySelector<HTMLElement>('tr.selected [data-row-id]');if(row)row.focus();else void focusEditor();} }
function discard() { switchDialog?.close(); if (pendingCustomer) void edit(pendingCustomer,pendingRow); else { create(); void focusEditor(); } }
const existing = $derived(editingId !== null);

function create() {
  readVersion++; readingId='';
  submitted = false; editingId = null; codeLocked = false; codeError = '';
  customer = {
    id: crypto.randomUUID(),
    code: '',
    name: '',
    attention: '',
    abn: '',
    address: '',
    nextNumber: 1,
  };
  savedJson = JSON.stringify(customer);
}

async function edit(item: Customer, row?:HTMLElement) {
  const version=++readVersion;readingId=item.id; submitted=false; codeError='';
  try { const result=await desktop.customer(item.id);if(version!==readVersion)return;customer={attention:'',...result.customer};codeLocked=result.codeLocked;editingId=item.id;savedJson=JSON.stringify(customer); }
  catch(cause) {if(version===readVersion)notify(String(cause), 'error');} finally {if(version===readVersion)readingId='';}
  if(version===readVersion)await focusEditor(row);
}

async function load() {
  busy = true;
  try {
    data = await desktop.searchCustomers(search,page);
    if (!customer.id) create();
  } catch (cause) {
    notify(String(cause), 'error');
  } finally {
    busy = false;
  }
}

async function save(event: SubmitEvent) {
  event.preventDefault();
  if (!canSave) return;
  submitted = true;
  if (Object.keys(errors).length) { if (errors.id) notify(errors.id, 'error'); focusInvalid(form); return; }
  busy = true;
  try {
    if(!await desktop.customerCodeAvailable(customer.code,customer.id)) { codeError='This customer code is already in use.'; focusInvalid(form); return; }
    await desktop.saveCustomer({ ...customer });
    notify('Customer saved.');
    data = await desktop.searchCustomers(search,page);
    const saved = (await desktop.customer(customer.id)).customer;
    if (saved) { customer = { attention:'', ...saved }; editingId = saved.id; }
    savedJson = JSON.stringify(customer);
  } catch (cause) {
    notify(String(cause), 'error');
  } finally {
    busy = false;
  }
}

onMount(() => {
  void load();
  return () => { readVersion++; };
});
const searchError=$derived(fieldErrors(searchSchema,{query:search}).query);
</script><svelte:head><title>Customers</title></svelte:head>
<UnsavedChanges {dirty} />
<div class="page-heading"><Breadcrumbs current="Customers"/><Button data-command="new" type="button" onclick={() => select(null)} disabled={busy || !data}>New customer</Button></div>
{#if !data && !busy}<Button type="button" onclick={load}>Retry loading customers</Button>{/if}
<div class="page-content master-detail">
<section use:rowNavigation={selectRow} data-shortcut-context="list" data-shortcut-label="Customers" data-shortcut-default class="panel" aria-label="Saved customers" aria-busy={listing}><div class="toolbar"><Field command="search" id="customer-search" label="Search customers" type="search" bind:value={search} error={searchError} submitted /></div>
{#if listError}<Button type="button" onclick={()=>revision++}>Retry loading customers</Button>{:else if matches.length}<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
<section class="table-scroll" aria-label="Customers table" tabindex="0"><table><thead><tr><th scope="col">Customer</th><th scope="col">Code</th><th scope="col">Next invoice</th></tr></thead><tbody>{#each matches as item (item.id)}<tr class:selected={(readingId || customer.id) === item.id}><td><Button data-row-id={item.id} class="link-button" type="button" disabled={busy} onclick={event => select(item,event.detail ? event.currentTarget : undefined)} aria-label={`Edit ${item.code}`}>{item.name || displayValue(item.abn, 'abn')}</Button>{#if item.abn}<small>ABN {displayValue(item.abn, 'abn')}</small>{/if}</td><td>{item.code}</td><td>I{item.code}{item.nextNumber}</td></tr>{/each}</tbody></table></section>{:else}<div class="empty">{#if listing}Loading customers…{:else}<h2>{search ? 'No matching customers' : 'No customers yet'}</h2><p>{search ? 'Try a name, code or ABN.' : 'Enter customer details to get started.'}</p>{/if}</div>{/if}
<Pagination page={page} total={data?.total ?? 0} busy={busy || listing} onchange={value=>page=value}/></section>
{#key customer.id}<form data-shortcut-context="editor" data-shortcut-label="Customer details" class="panel panel-body" bind:this={form} novalidate onsubmit={save}><fieldset disabled={busy || !!readingId || !data} aria-busy={busy || !!readingId}><h2 id="record-editor-heading" tabindex="-1">{existing || readingId ? 'Customer details' : 'New customer'}</h2>
{#if readingId}<p role="status">Loading customer details…</p>{:else}
<CustomerFields bind:customer errors={{...errors,code:codeError || errors.code}} {submitted} {codeLocked}/>

<div class="sequence"><span>Next invoice</span><strong>I{customer.code || 'CODE'}{customer.nextNumber}</strong></div>
<div class="form-actions"><small>{dirty ? 'Unsaved changes' : ''}</small><Button data-command="save" class="primary save-button" type="submit" disabled={!canSave}>Save customer</Button></div>
{#if existing && !dirty}<a class="button create-invoice" href={`/invoices/edit?customer=${encodeURIComponent(customer.id)}`}>New draft for {customer.code}<Icon name="arrow" size={14} /></a>{/if}
{/if}</fieldset></form>{/key}
</div>
<dialog data-shortcut-context="dialog" bind:this={switchDialog} aria-labelledby="switch-title" oncancel={event=>{event.preventDefault();keepEditing();}}><h2 id="switch-title">Unsaved customer changes</h2><p>Discard your changes and switch customers?</p><div class="actions"><Button class="primary" type="button" data-tooltip-keys="Escape" onclick={keepEditing}>Keep editing</Button><Button type="button" onclick={discard}>Discard changes</Button></div></dialog>
<style>td:not(:first-child){white-space:nowrap}.sequence { display:flex; justify-content:space-between; padding:calc(12rem / 13) 0 0; font-size:calc(12rem / 13); } .sequence strong { color:var(--ink); } .create-invoice { margin-top:calc(8rem / 13); width:100%; }</style>
