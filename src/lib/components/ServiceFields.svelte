<script lang="ts">
import type {Service} from '../domain/types';
import {Field} from './ui';

let {service=$bindable(),errors={},submitted=false,prefix='service'}:{service:Service;errors?:Record<string,string>;submitted?:boolean;prefix?:string}=$props();
</script>
<div class="form-grid">
 <Field id={`${prefix}-name`} label="Service name" bind:value={service.name} error={errors.name} {submitted} required full/>
 <Field id={`${prefix}-price`} label="Unit price (AUD, ex GST)" format="money" bind:value={service.unitPrice} error={errors.unitPrice} {submitted} inputmode="decimal" required/>
 <Field id={`${prefix}-tax`} label="GST classification" kind="select" bind:value={service.tax} error={errors.tax} {submitted} options={[{value:'taxable',label:'10% GST'},{value:'gstFree',label:'GST-free'},{value:'inputTaxed',label:'Input taxed'},{value:'noGst',label:'No GST'}]}/>
 <Field id={`${prefix}-description`} label="Invoice description" kind="textarea" rows={3} bind:value={service.description} error={errors.description} {submitted} required full/>
</div>
