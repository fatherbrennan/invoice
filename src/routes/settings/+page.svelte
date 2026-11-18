<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';

onMount(() => { void goto('/settings/preferences', { replaceState: true }); });
</script>
<p class="note">Opening preferences…</p>
