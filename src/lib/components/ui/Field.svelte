<script lang="ts">
import type { HTMLInputAttributes } from 'svelte/elements';
import {displayValue, type FieldFormat, rawValue } from '../../format';
import RecordCombobox from './RecordCombobox.svelte';

let { id, label, command, format, readonly = false, onkeydown, displayLabel, kind = 'input', type = 'text', value = $bindable(''), checked = $bindable(false), options = [], error = '', submitted = false, hint = '', disabled = false, required = false, rows = 2, inputmode, autocomplete, placeholder = '', uppercase = false, full = false, compact = false }: {
  id: string; label: string; format?: FieldFormat; command?: string; readonly?: boolean; onkeydown?: (event: KeyboardEvent) => void; displayLabel?: string; kind?: 'input' | 'textarea' | 'select' | 'checkbox'; type?: 'text' | 'search' | 'date';
  value?: string; checked?: boolean; options?: { value: string; label: string; disabled?: boolean }[];
  error?: string; submitted?: boolean; hint?: string; disabled?: boolean; required?: boolean; rows?: number;
  inputmode?: HTMLInputAttributes['inputmode']; autocomplete?: HTMLInputAttributes['autocomplete']; placeholder?: string; uppercase?: boolean; full?: boolean; compact?: boolean;
} = $props();
let touched = $state(false);
let focused = $state(false), editingValue = $state('');
function focus() { editingValue = displayValue(value, format); focused = true; }
function input(next: string) { editingValue = uppercase ? next.toUpperCase() : next; value = rawValue(editingValue, format); }
const visibleError = $derived((touched || submitted) ? error : '');
const describedBy = $derived(visibleError || hint ? `${id}-message` : undefined);
function blur(event: FocusEvent) {
  focused = false;
  // Revealing an error before a button's click can move it out from under the pointer.
  if (!(event.relatedTarget instanceof HTMLButtonElement)) touched = true;
}
</script>
{#if kind === 'select'}
<RecordCombobox {id} {label} {disabled} {required} {hint} {full} {compact} error={visibleError} onblur={blur} options={options.map(option=>({id:option.value,name:option.label,disabled:option.disabled}))} value={options.find(option=>option.value===value)?.label ?? ''} onselect={option=>value=option.id}/>
{:else}
<div class="admin-field" class:full class:compact class:invalid={!!visibleError} class:check-field={kind === 'checkbox'}>
  <div class="field-control">
    <label for={id} data-tooltip-commands={command} title={displayLabel ?? label}>{displayLabel ?? label}{#if required}<span aria-hidden="true"> *</span>{/if}</label>
    {#if kind === 'textarea'}
      <textarea {id} bind:value {rows} {disabled} {placeholder} {autocomplete} aria-label={label} aria-required={required} aria-invalid={!!visibleError} aria-describedby={describedBy} onblur={blur}></textarea>
    {:else if kind === 'checkbox'}
      <input {id} type="checkbox" aria-label={label} bind:checked {disabled} aria-invalid={!!visibleError} aria-describedby={describedBy} onblur={blur} />
    {:else}
      <input {readonly} {onkeydown} data-command={command} {id} {type} onfocus={focus} bind:value={() => format && focused ? editingValue : displayValue(value, format), input} {disabled} {inputmode} {autocomplete} {placeholder} aria-label={label} aria-required={required} aria-invalid={!!visibleError} aria-describedby={describedBy} onblur={blur} />
    {/if}
  </div>
  {#if visibleError || hint}<small class="field-message" class:error-message={!!visibleError} id={`${id}-message`} aria-live="polite">{visibleError || hint}</small>{/if}
</div>

{/if}
