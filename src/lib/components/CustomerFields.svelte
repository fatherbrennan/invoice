<script lang="ts">
import type {Customer} from '../domain/types';
import {Field} from './ui';

let {customer=$bindable(),errors={},submitted=false,codeLocked=false,prefix='customer'}:{customer:Customer;errors?:Record<string,string>;submitted?:boolean;codeLocked?:boolean;prefix?:string}=$props();
</script>
<div class="form-grid">
<Field id={`${prefix}-name`} label="Customer name" bind:value={customer.name} error={errors.name} {submitted} required={!customer.abn.trim()} autocomplete="organization" full />
<Field id={`${prefix}-code`} label="Customer code" bind:value={customer.code} error={errors.code} {submitted} required uppercase disabled={codeLocked} hint={codeLocked ? 'Fixed after first issue.' : 'Unique, 1–12 letters.'} />
<Field id={`${prefix}-abn`} label="ABN (11 digits, if supplied)" format="abn" bind:value={customer.abn} error={errors.abn} {submitted} required={!customer.name.trim()} inputmode="numeric" />
<Field id={`${prefix}-attention`} label="Attention" bind:value={customer.attention} error={errors.attention} {submitted} full/>
<Field id={`${prefix}-address`} label="Customer address" kind="textarea" bind:value={customer.address} error={errors.address} {submitted} autocomplete="street-address" rows={2} full />
</div>