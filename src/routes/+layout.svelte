<script lang="ts">
import '../app.css';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import Icon from '../lib/components/Icon.svelte';
import ShortcutBar from '../lib/components/ShortcutBar.svelte';
import OverlayScrollbars from '../lib/components/ui/OverlayScrollbars.svelte';
import ShortcutTooltip from '../lib/components/ui/ShortcutTooltip.svelte';
import ToastHost from '../lib/components/ui/ToastHost.svelte';
import WindowTitleBar from '../lib/components/WindowTitleBar.svelte';
import {ledgerMemory} from '../lib/ledger-memory.svelte';
import { notify } from '../lib/notifications';
import { initializePreferences, preferences } from '../lib/preference-store';

let { children } = $props();
const links = [{ href: '/invoices', label: 'Invoices', icon: 'invoices', command: 'goInvoices' }, { href: '/customers', label: 'Customers', icon: 'customers', command: 'goCustomers' }, { href: '/services', label: 'Services', icon: 'services', command: 'goServices' }, { href: '/profile', label: 'Business profile', icon: 'profile', command: 'goProfile' }, { href: '/settings/preferences', label: 'Settings', icon: 'settings', command: 'preferences' }];
onMount(initializePreferences);
$effect(() => { document.documentElement.style.fontSize = `${13 * $preferences.zoom / 100}px`; });
let cancelInitialFocus = () => {};
afterNavigate(({from, to}) => {
  cancelInitialFocus();
  if (from?.url.pathname === to?.url.pathname) return;
  const selectors: Record<string,string> = {
    '/invoices': '#invoice-search',
    '/invoices/edit': to?.url.searchParams.has('customer') ? '#invoice-date' : '#customer',
    '/customers': '#customer-search', '/services': '#service-search',
  };
  const selector = selectors[to?.url.pathname ?? ''];
  const main = document.getElementById('main');
  if (!selector || !main) return;
  const observer = new MutationObserver(focus);
  function cancel() {
    observer.disconnect();
    document.removeEventListener('pointerdown', cancel, true);
    document.removeEventListener('keydown', cancel, true);
  }
  function focus() {
    const field = document.querySelector<HTMLElement>(selector);
    if (!field || field.matches(':disabled') || !field.getClientRects().length) return;
    cancel(); field.focus({preventScroll:true});
  }
  // Async pages can render disabled fields first; stop waiting if the user starts interacting.
  observer.observe(main, {subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
  document.addEventListener('pointerdown', cancel, true);
  document.addEventListener('keydown', cancel, true);
  cancelInitialFocus = cancel;
  focus();
});
onMount(() => () => cancelInitialFocus());
$effect(() => {
  const theme = $preferences.theme;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme; };
  apply(); media.addEventListener('change', apply);
  if (isTauri()) void getCurrentWindow().setTheme(theme === 'system' ? null : theme).catch(cause=>notify(`Could not update window theme: ${String(cause)}`, 'error'));
  return () => media.removeEventListener('change', apply);
});
</script>
<a class="skip-link" href="#main">Skip to content</a>
<div class="app-shell">
  <WindowTitleBar/>
  <header class="app-header">
    <a class="brand" href="/invoices"><img src="/logo.svg" width="24" height="24" alt="" /><span class="sr-only">Invoice home</span></a>
    <nav aria-label="Main navigation">
      {#each links as link, index (link.href)}
        <a class:settings-link={index === 3} data-command={link.command} href={link.command==='goInvoices'?ledgerMemory.href:link.href} aria-current={page.url.pathname.startsWith(link.command==='preferences'?'/settings':link.href) ? 'page' : undefined}><Icon name={link.icon} size={16} />{link.label}</a>
      {/each}
    </nav>
  </header>
  <div class="workspace">
    <main id="main" tabindex="-1" data-shortcut-context="page" data-shortcut-label={links.find(link=>page.url.pathname.startsWith(link.command==='preferences'?'/settings':link.href))?.label ?? 'Workspace'}>{@render children()}</main>
  </div>
</div>
<a class="sr-only" tabindex="-1" href="/settings/data" data-command="goData">Data settings</a>
<ShortcutBar/>
<ShortcutTooltip/>
<OverlayScrollbars/>
<ToastHost/>
