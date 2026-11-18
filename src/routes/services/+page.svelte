<script lang="ts">
import {onMount} from 'svelte';
import Breadcrumbs from '../../lib/components/Breadcrumbs.svelte';
import ServiceFields from '../../lib/components/ServiceFields.svelte';
import UnsavedChanges from '../../lib/components/UnsavedChanges.svelte';
import {Button,Field,Pagination} from '../../lib/components/ui';
import {desktop,money} from '../../lib/desktop';
import type {Page, Service} from '../../lib/domain/types';
import { notify } from '../../lib/notifications';
import { focusRecord, rowNavigation } from '../../lib/row-navigation';
import {fieldErrors,focusInvalid, searchSchema, serviceSchema} from '../../lib/validation';

let service=$state<Service>({id:'',name:'',description:'',unitPrice:'0.00',tax:'taxable'});
let result=$state<Page<Service>>({items:[],total:0,page:0,pageSize:25});
let search=$state(''),page=$state(0),revision=$state(0),editing=$state(false),savedJson=$state('');
let busy=$state(false),loading=$state(true),submitted=$state(false);
let listError=$state('');
function focusEditor(row?:HTMLElement){return focusRecord('service-name',row);}
let form=$state<HTMLFormElement|null>(null); let switchDialog:HTMLDialogElement;let deleteDialog:HTMLDialogElement;let pending:Service|null=null;
let pendingRow:HTMLElement|undefined;
const errors=$derived(fieldErrors(serviceSchema,service));
const dirty=$derived(!!service.id && JSON.stringify(service)!==savedJson);
const canSave=$derived(dirty && !busy);
const taxLabels={taxable:'10% GST',gstFree:'GST-free',inputTaxed:'Input taxed',noGst:'No GST'};
function edit(item:Service|null){service=item?{...item}:{id:crypto.randomUUID(),name:'',description:'',unitPrice:'0.00',tax:'taxable'};editing=!!item;savedJson=JSON.stringify(service);submitted=false;}
function select(item:Service|null,row?:HTMLElement){if(busy)return;if(item?.id===service.id){void focusEditor(row);return;}if(dirty){pending=item;pendingRow=row;switchDialog.showModal();}else {edit(item);void focusEditor(row);}}
function selectRow(id:string,row:HTMLElement){const item=result.items.find(item=>item.id===id);if(item)select(item,row);}
function keepEditing(){switchDialog.close();if(pendingRow){const row=pendingRow.closest('tbody')?.querySelector<HTMLElement>('tr.selected [data-row-id]');if(row)row.focus();else void focusEditor();}}
$effect(()=>{const term=search;if(term!==undefined)page=0;});
$effect(()=>{
 const term=search,current=page;void revision; if(searchError){result={items:[],total:0,page:0,pageSize:25};loading=false;return;}let cancelled=false;loading=true;
 const timer=setTimeout(()=>{void desktop.searchServices(term,current).then(data=>{if(!cancelled){result=data;listError='';}}).catch(cause=>{if(!cancelled)listError=notify(String(cause), 'error');}).finally(()=>{if(!cancelled)loading=false;});},200);
 return()=>{cancelled=true;clearTimeout(timer);};
});
onMount(()=>edit(null));
async function save(event:SubmitEvent){event.preventDefault();if(!canSave)return;submitted=true;if(Object.keys(errors).length){focusInvalid(form);return;}busy=true;try{await desktop.saveService($state.snapshot(service));savedJson=JSON.stringify(service);editing=true;revision++;notify('Service saved.');}catch(cause){notify(String(cause), 'error');}finally{busy=false;}}
async function remove(){if(busy)return;busy=true;try{await desktop.deleteService(service.id);deleteDialog.close();edit(null);page=0;revision++;notify('Service removed. Saved invoice lines are unchanged.');busy=false;await focusEditor();}catch(cause){notify(String(cause), 'error');}finally{busy=false;}}
const searchError=$derived(fieldErrors(searchSchema,{query:search}).query);
</script>
<svelte:head><title>Services</title></svelte:head>
<UnsavedChanges {dirty}/>
<div class="page-heading"><Breadcrumbs current="Services"/><Button data-command="new" type="button" disabled={busy} onclick={()=>select(null)}>New service</Button></div>
<div class="page-content master-detail">
<section use:rowNavigation={selectRow} data-shortcut-context="list" data-shortcut-label="Services" data-shortcut-default class="panel" aria-label="Saved services" aria-busy={loading}><div class="toolbar"><Field command="search" id="service-search" label="Search services" type="search" bind:value={search} error={searchError} submitted/></div>
{#if listError}<Button type="button" onclick={()=>revision++}>Retry loading services</Button>{:else}<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
<section class="table-scroll" aria-label="Services table" tabindex="0"><table><thead><tr><th scope="col">Service</th><th scope="col" class="numeric">Unit ex GST</th><th scope="col">GST</th></tr></thead><tbody>{#each result.items as item(item.id)}<tr class:selected={item.id===service.id}><td><Button data-row-id={item.id} class="link-button" type="button" disabled={busy} onclick={event=>select(item,event.detail ? event.currentTarget : undefined)} aria-label={`Edit ${item.name}`}>{item.name}</Button></td><td class="numeric">{money(Math.round(Number(item.unitPrice)*100))}</td><td>{taxLabels[item.tax]}</td></tr>{/each}</tbody></table></section>
{#if !result.items.length}<p class="empty">{loading?'Loading services…':search?'No matching services.':'Enter a service to get started.'}</p>{/if}
{/if}<Pagination {...result} busy={loading} onchange={value=>page=value}/></section>
{#key service.id}<form data-shortcut-context="editor" data-shortcut-label="Service details" class="panel panel-body" bind:this={form} novalidate onsubmit={save}><fieldset disabled={busy}><h2 id="record-editor-heading" tabindex="-1">{editing?'Service details':'New service'}</h2><ServiceFields bind:service {errors} {submitted}/>
<div class="form-actions">{#if editing}<Button class="danger" type="button" onclick={()=>{deleteDialog.showModal();}}>Remove service</Button>{/if}<small>{dirty?'Unsaved changes':''}</small><Button data-command="save" class="primary save-button" type="submit" disabled={!canSave}>Save service</Button></div>
</fieldset></form>{/key}</div>
<dialog data-shortcut-context="dialog" bind:this={switchDialog} aria-labelledby="switch-service" oncancel={event=>{event.preventDefault();keepEditing();}}><h2 id="switch-service">Unsaved service changes</h2><p>Discard your changes and switch services?</p><div class="actions"><Button class="primary" type="button" data-tooltip-keys="Escape" onclick={keepEditing}>Keep editing</Button><Button type="button" onclick={()=>{switchDialog.close();edit(pending);void focusEditor(pendingRow);}}>Discard changes</Button></div></dialog>
<dialog data-shortcut-context="dialog" bind:this={deleteDialog} aria-labelledby="remove-service" oncancel={event=>{if(busy)event.preventDefault();}}><h2 id="remove-service">Remove {service.name}?</h2><p>This removes the catalogue entry. Saved invoice lines and issued snapshots stay unchanged.</p><div class="actions"><Button type="button" data-tooltip-keys="Escape" disabled={busy} onclick={()=>deleteDialog.close()}>Cancel</Button><Button class="danger primary" type="button" disabled={busy} onclick={remove}>Confirm removal</Button></div></dialog>

<style>td:not(:first-child){white-space:nowrap}</style>
