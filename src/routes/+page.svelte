<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';

onMount(() => { void goto('/invoices', { replaceState: true }); });
</script>
<p class="muted">Opening your invoices…</p>
