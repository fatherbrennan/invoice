<script lang="ts" generics="T extends {id:string;name:string;code?:string;disabled?:boolean}">
import {tick} from 'svelte';
import type {Page} from '../../domain/types';
import {positionDropdown} from '../../dropdown-position';
import { notify } from '../../notifications';
import {fieldErrors,searchSchema} from '../../validation';
import Icon from '../Icon.svelte';
import Button from './Button.svelte';

let {id,label,noun='option',options,hint='',required=false,full=false,onblur,searchable=options===undefined,value='',error='',disabled=false,compact=false,loader,itemLabel=(item:T)=>item.name||item.code||'',trailing,onselect,oncreate}:{id:string;label:string;noun?:string;options?:T[];hint?:string;required?:boolean;full?:boolean;onblur?:(event:FocusEvent)=>void;searchable?:boolean;value?:string;error?:string;disabled?:boolean;compact?:boolean;loader?:(query:string,page:number)=>Promise<Page<T>>;itemLabel?:(item:T)=>string;trailing?:(item:T)=>string;onselect:(item:T)=>void;oncreate?:((query:string)=>void)}=$props();
let searching=$state(false);
let open=$state(false),query=$state(''),page=$state(0),busy=$state(false),failure=$state(''),active=$state(-1);
let result=$state<Page<T>>({items:[],total:0,page:0,pageSize:25});
let root:HTMLDivElement;let input=$state<HTMLInputElement>();
const searchError=$derived(fieldErrors(searchSchema,{query}).query);
const visibleError=$derived(searchError || error);
$effect(()=>{const term=query;if(term!==undefined)page=0;});
$effect(()=>{
 const term=query,current=page;if(!open)return;
 if(options){const matches=options.filter(item=>!searchable||itemLabel(item).toLocaleLowerCase().includes(term.toLocaleLowerCase()));result={items:matches,total:matches.length,page:0,pageSize:matches.length};active=matches.findIndex(item=>!item.disabled && itemLabel(item)===value);busy=false;return;}
 result={items:[],total:0,page:current,pageSize:25};active=-1;failure='';
 if(searchError){busy=false;return;}
 let cancelled=false;busy=true;
 const timer=setTimeout(()=>{void loader?.(term,current).then(data=>{if(!cancelled)result=data;}).catch(cause=>{if(!cancelled)failure=notify(String(cause), 'error');}).finally(()=>{if(!cancelled)busy=false;});},150);
 return()=>{cancelled=true;clearTimeout(timer);};
});
function show(){if(disabled)return;query='';searching=false;page=0;open=true;if(searchable)input?.select();}
function choose(item:T){if(item.disabled)return;onselect(item);input?.focus();open=false;}
function create(){const term=query;open=false;oncreate?.(term);}
async function key(event:KeyboardEvent){
 if(!searchable && event.key===' '){event.preventDefault();show();}
 else if(!searchable && event.key.length===1 && !event.ctrlKey && !event.altKey && !event.metaKey){event.preventDefault();if(!open){show();await tick();}const match=options?.find(item=>!item.disabled&&itemLabel(item).toLowerCase().startsWith(event.key.toLowerCase()));if(match)active=options?.indexOf(match)??-1;}
 else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();open=false;}
 else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault();if(!open){show();return;}
  const enabled=result.items.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);
  const position=enabled.indexOf(active);
  active=event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1) ?? -1:enabled[Math.max(0,Math.min(enabled.length-1,position+(event.key==='ArrowDown'?1:-1)))] ?? -1;
  await tick();document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block:'nearest'});
 }else if(event.key==='Enter'&&open){event.preventDefault();const item=result.items[active] ?? (result.items.length===1?result.items[0]:undefined);if(item&&!busy&&!item.disabled)choose(item);}
}
</script>
<div data-shortcut-context={open ? "picker" : undefined} data-shortcut-label={`${noun} picker`} class="admin-field record-combobox" class:compact class:full bind:this={root} class:invalid={!!visibleError} onfocusout={event=>{if(!root.contains(event.relatedTarget as Node)){open=false;onblur?.(event);}}}>
 <div class="field-control">
  <label class:sr-only={compact} for={id} title={label}>{label}{#if required}<span aria-hidden="true"> *</span>{/if}</label>
  <input bind:this={input} {id} role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete={searchable?"list":"none"} readonly={!searchable} aria-activedescendant={open&&result.items[active]?`${id}-option-${active}`:undefined} aria-required={required} aria-invalid={!!visibleError} aria-describedby={visibleError||hint?`${id}-error`:undefined} {disabled} value={open&&searching?query:value} placeholder={`Choose ${noun}…`} autocomplete="off" onfocus={show} onclick={()=>{if(!open)show();}} oninput={event=>{searching=true;query=event.currentTarget.value;open=true;}} onkeydown={key}/>
  <Button class="field-dropdown-action quiet" type="button" tabindex={-1} {disabled} aria-label={`Show ${label.toLowerCase()}`} onpointerdown={event=>event.preventDefault()} onclick={()=>{if(open)open=false;else{input?.focus();show();}}}><Icon name="chevron" size={16}/></Button>
 </div>
 {#if visibleError||hint}<small id={`${id}-error`} class="field-message" class:error-message={!!visibleError}>{visibleError||hint}</small>{/if}
 {#if open && input}<div class="suggestions" use:positionDropdown={input}>
  <div id={`${id}-list`} role="listbox" aria-label={`Known ${noun}s`} aria-busy={busy}>
   {#each result.items as item,index(item.id)}<Button id={`${id}-option-${index}`} type="button" role="option" tabindex={-1} disabled={item.disabled} aria-selected={active===index} onpointerdown={event=>event.preventDefault()} onclick={()=>choose(item)}><span><strong>{itemLabel(item)}</strong>{#if noun==='customer' && item.code}<small>{item.code}</small>{/if}</span>{#if trailing}<span class="numeric">{trailing(item)}</span>{/if}</Button>{/each}
  </div>
  {#if busy || failure || (!result.items.length&&!searchError)}<p class="search-status" role="status">{busy?'Searching…':failure?'Search unavailable. Try again.':`No ${noun}s found`}</p>{/if}
  {#if oncreate || (!options && result.total>25)}<div class="suggestion-actions">{#if oncreate}<Button class="quiet" type="button" onclick={create}>Create {noun}…</Button>{/if}{#if !options && result.total>25}<div class="actions"><Button class="icon-button" data-command="previousPage" type="button" disabled={busy||page===0} onclick={()=>page--} aria-label={`Previous ${noun}s`}><Icon name="left" size={16}/></Button><span>{page+1}/{Math.ceil(result.total/25)}</span><Button class="icon-button" data-command="nextPage" type="button" disabled={busy||(page+1)*25>=result.total} onclick={()=>page++} aria-label={`Next ${noun}s`}><Icon name="right" size={16}/></Button></div>{/if}</div>{/if}
 </div>{/if}
</div>
<style>
.record-combobox{position:relative;min-width:0}.compact .field-control>input{text-align:left}.suggestions{display:flex;flex-direction:column;overflow:hidden;position:fixed;z-index:20;width:max(100%,calc(320rem / 13));max-width:calc(100vw - calc(24rem / 13));background:var(--paper);border:1px solid var(--line-strong)}.suggestions [role="listbox"]{min-height:0;max-height:calc(230rem / 13);overflow:auto}.suggestions :global([role="option"]){display:flex;width:100%;justify-content:space-between;border:0;text-align:left;white-space:normal;padding:calc(7rem / 13) calc(9rem / 13);gap:calc(12rem / 13)}.suggestions :global([role="option"][aria-selected="true"]){background:var(--soft)}.suggestions strong{font-size:1rem;font-weight:400;overflow-wrap:anywhere}.suggestions small{display:block;font-size:calc(12rem / 13)}.suggestion-actions{flex-shrink:0;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:calc(4rem / 13)}.suggestion-actions .actions{gap:calc(5rem / 13);font-size:calc(12rem / 13)}.search-status{margin:0;padding:calc(8rem / 13);background:none;color:var(--muted);font-size:calc(12rem / 13)}
</style>
