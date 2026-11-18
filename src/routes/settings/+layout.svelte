<script lang="ts">
import { page } from '$app/state';
import Breadcrumbs from '../../lib/components/Breadcrumbs.svelte';
import { SectionTabs } from '../../lib/components/ui';

let {children} = $props();
</script>
<div class="page-heading"><Breadcrumbs current="Settings"/></div>
<SectionTabs label="Settings sections" items={[
  {label:'Preferences',href:'/settings/preferences',current:page.url.pathname.endsWith('/preferences'),command:'preferences'},
  {label:'Data',href:'/settings/data',current:page.url.pathname.endsWith('/data'),command:'goData'},
]}/>
<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to scrolling.) -->
<!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to scrolling. -->
<section class="page-content settings-content" aria-label="Settings content" tabindex="0">{@render children()}</section>
<style>
.settings-content:has(:global(.preferences-content)){display:flex;flex-direction:column}
</style>
