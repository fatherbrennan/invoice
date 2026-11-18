<script lang="ts">
import { onMount } from 'svelte';
import Breadcrumbs from '../../lib/components/Breadcrumbs.svelte';
import UnsavedChanges from '../../lib/components/UnsavedChanges.svelte';
import { Button, Field } from '../../lib/components/ui';
import { desktop } from '../../lib/desktop';
import type { PayIdType, PaymentMethod, Profile } from '../../lib/domain/types';
import { notify } from '../../lib/notifications';
import { newPaymentMethod, payIdTypes, paymentTypes } from '../../lib/payments';
import { fieldErrors, focusInvalid, profileSchema } from '../../lib/validation';

let profile = $state<Profile>({
  name: '',
  abn: '',
  address: '',
  paymentDetails: '',
  paymentMethods: [],
  gstRegistered: false,
  showItemGst: false,
});
let busy = $state(true);
let loaded = $state(false);
let savedJson = $state('');
let submitted = $state(false);let savedNow=$state(false);
let form = $state<HTMLFormElement | null>(null);
const errors = $derived(fieldErrors(profileSchema, profile));
const dirty = $derived(loaded && JSON.stringify(profile) !== savedJson);
const canSave = $derived(dirty && !busy);

async function load() {
  busy = true;
  try {
    const data = await desktop.workspace();
    if (data.profile) profile = { ...data.profile, paymentMethods: data.profile.paymentMethods ?? [] };
    savedJson = JSON.stringify(profile);
    loaded = true;
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
  if (Object.keys(errors).length) { focusInvalid(form); return; }
  busy = true;
  try {
    await desktop.saveProfile({ ...profile });
    savedJson = JSON.stringify(profile);
    notify('Business profile saved.');savedNow=true;
  } catch (cause) {
    notify(String(cause), 'error');
  } finally {
    busy = false;
  }
}

onMount(() => {
  void load();
});
</script>
<svelte:head><title>Business profile</title></svelte:head>
<UnsavedChanges {dirty} />
<div class="page-heading"><Breadcrumbs current="Business profile"/></div>

{#if !loaded && !busy}<Button type="button" onclick={load}>Retry loading profile</Button>{/if}
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to scrolling. -->
<section class="page-content" aria-label="Business profile content" tabindex="0">
<form data-shortcut-context="editor" data-shortcut-label="Business profile" data-shortcut-default class="panel panel-body settings-form" bind:this={form} novalidate onsubmit={save}>
<fieldset disabled={busy || !loaded} aria-busy={busy}>
 <div class="profile-sections">
 <section aria-labelledby="business-heading"><h2 id="business-heading">Business details</h2>
  <div class="form-grid">
    <Field id="business-name" label="Business name" bind:value={profile.name} error={errors.name} {submitted} required autocomplete="organization" />
    <Field id="business-abn" label="ABN (11 digits)" format="abn" bind:value={profile.abn} error={errors.abn} {submitted} required={profile.gstRegistered} inputmode="numeric" />
    <Field id="business-address" label="Business address" kind="textarea" bind:value={profile.address} error={errors.address} {submitted} required autocomplete="street-address" full />

  </div>
  </section>
  <section class="payment-section" aria-labelledby="payment-heading"><h2 id="payment-heading">Payment details</h2>
    {#each profile.paymentMethods ?? [] as method,index(index)}
      <div class="payment-method">
        <Field id={`payment-type-${index}`} label={`Payment method ${index+1}`} kind="select" bind:value={() => method.type, value => { if(profile.paymentMethods && value!==method.type) profile.paymentMethods[index]=newPaymentMethod(value as PaymentMethod['type']); }} options={paymentTypes.map(option=>({...option,disabled:option.value==='bpay' && method.type!=='bpay' && profile.paymentMethods?.some(m=>m.type==='bpay')}))} required/>
        <div class="payment-fields">
        {#if method.type === 'bankTransfer'}
          <Field id={`account-name-${index}`} label="Account name" bind:value={method.accountName} error={errors[`paymentMethods.${index}.accountName`]} {submitted} required/>
          <Field id={`bsb-${index}`} label="BSB" format="bsb" bind:value={method.bsb} error={errors[`paymentMethods.${index}.bsb`]} {submitted} placeholder="000-000" required/>
          <Field id={`account-number-${index}`} label="Account number" format="digits" bind:value={method.accountNumber} error={errors[`paymentMethods.${index}.accountNumber`]} {submitted} inputmode="numeric" required/>
        {:else if method.type === 'payId'}
          <Field id={`payid-type-${index}`} label="PayID type" kind="select" bind:value={() => method.payIdType, value => {if(value!==method.payIdType){method.payIdType=value as PayIdType;method.value='';}}} options={payIdTypes} required/>
          <Field id={`payid-value-${index}`} label={method.payIdType==='abn' ? 'PayID ABN' : method.payIdType==='organisationId' ? 'PayID organisation ID' : `PayID ${payIdTypes.find(type=>type.value===method.payIdType)?.label.toLowerCase()}`} format={method.payIdType==='abn' ? 'abn' : method.payIdType==='mobile' ? 'mobile' : undefined} bind:value={method.value} error={errors[`paymentMethods.${index}.value`]} {submitted} required/>
          <Field id={`payid-name-${index}`} label="Recipient name (optional)" bind:value={method.recipientName} error={errors[`paymentMethods.${index}.recipientName`]} {submitted}/>
        {:else if method.type === 'bpay'}
          <Field id={`biller-code-${index}`} label="BPAY biller code" format="digits" bind:value={method.billerCode} error={errors[`paymentMethods.${index}.billerCode`]} {submitted} inputmode="numeric" required/>
          <p class="note">Use your registered biller code. Enter the customer reference number (CRN) on each invoice, using your bank's approved reference scheme.</p>
        {:else}
          <Field id={`payment-label-${index}`} label={`Payment name ${index+1}`} bind:value={method.label} error={errors[`paymentMethods.${index}.label`]} {submitted} required/>
          <Field id={`payment-value-${index}`} label={`Payment details ${index+1}`} kind="textarea" bind:value={method.value} error={errors[`paymentMethods.${index}.value`]} {submitted} required/>
        {/if}
        </div>
        <div class="method-actions">
          <Button class="quiet" type="button" aria-label={`Move payment method ${index+1} up`} disabled={index===0} onclick={()=>{const methods=profile.paymentMethods;if(methods) [methods[index-1],methods[index]]=[methods[index],methods[index-1]];}}>Up</Button>
          <Button class="quiet" type="button" aria-label={`Move payment method ${index+1} down`} disabled={index===(profile.paymentMethods?.length ?? 0)-1} onclick={()=>{const methods=profile.paymentMethods;if(methods) [methods[index],methods[index+1]]=[methods[index+1],methods[index]];}}>Down</Button>
          <Button class="quiet danger" type="button" aria-label={`Remove payment method ${index+1}`} onclick={()=>profile.paymentMethods?.splice(index,1)}>Remove</Button>
        </div>
      </div>
    {/each}
    <Button type="button" disabled={(profile.paymentMethods?.length ?? 0)>=10} onclick={()=>{profile.paymentMethods ??= [];profile.paymentMethods.push(newPaymentMethod('bankTransfer'));}}>Add payment method</Button>
    <p class="note">Checks cover format only; confirm these details with your bank or payment provider. Methods appear on invoices in this order.</p>
    <Field id="payment-details" label="Other payment instructions" kind="textarea" bind:value={profile.paymentDetails} error={errors.paymentDetails} {submitted} rows={2}/>
  </section>
 </div>
  <section class="section"><h2>Tax settings</h2><div class="form-grid">
    <Field id="gst-registered" label="Registered for GST" kind="checkbox" bind:checked={profile.gstRegistered} error={errors.gstRegistered} {submitted} />
    <Field id="item-gst" label="Show GST for each item" kind="checkbox" bind:checked={profile.showItemGst} error={errors.showItemGst} {submitted} />
  </div><p class="note">ABN validation checks format and checksum, not registration. Item GST display does not change amounts.</p></section>
  <div class="form-actions"><small>{dirty ? 'Unsaved changes' : 'Applies to new invoices. Issued PDFs stay unchanged.'}</small>{#if savedNow&&!dirty}<a class="button" href="/invoices/edit">Continue to new invoice</a>{/if}<Button data-command="save" class="primary save-button" type="submit" disabled={!canSave}>Save profile</Button></div>
</fieldset>

</form>
<p class="note scope-note">AUD - ordinary Australian domestic sales. Special GST schemes, BAS and adjustment notes are outside this app's scope.</p>
</section>
<style>
.profile-sections{display:grid;grid-template-columns:1fr 1fr;gap:calc(12rem / 13)}.payment-section{border-left:1px solid var(--line);padding-left:calc(12rem / 13)}.payment-section>:global(.admin-field){margin-top:calc(8rem / 13)}.payment-method{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:calc(8rem / 13);align-items:start;margin-bottom:calc(8rem / 13)}.payment-fields{display:grid;gap:calc(8rem / 13)}.method-actions{grid-column:1/-1;display:flex;gap:calc(4rem / 13);justify-content:flex-end}.payment-method{padding-bottom:calc(8rem / 13);border-bottom:1px solid var(--line)}.section{margin-top:calc(12rem / 13);padding-top:calc(12rem / 13);border-top:1px solid var(--line)}.section .note{margin:calc(8rem / 13) 0 0}.scope-note{margin-top:calc(8rem / 13)}
@container app (max-width: calc(900rem / 13)){.profile-sections{grid-template-columns:1fr;gap:calc(12rem / 13)}.payment-section{border-left:0;border-top:1px solid var(--line);padding:calc(12rem / 13) 0 0}}
@container app (max-width: calc(620rem / 13)){.payment-method{grid-template-columns:minmax(0,1fr)}.payment-fields,.method-actions{grid-column:1}}
</style>
