<script lang="ts">
import { onMount, tick } from 'svelte';
import plexFontLicense from '../../../../static/licenses/IBMPlexSans-OFL.txt?raw';
import pdfLicense from '../../../../static/licenses/PDFjs-Apache-2.0.txt?raw';
import subsetterLicense from '../../../../static/licenses/Subsetter-notices.txt?raw';
import validationLicense from '../../../../static/licenses/Valibot-MIT.txt?raw';
import FileLocation from '../../../lib/components/FileLocation.svelte';
import { Button } from '../../../lib/components/ui';
import { desktop } from '../../../lib/desktop';
import { notify } from '../../../lib/notifications';

let busy = $state(false);
let restoreDialog = $state<HTMLDialogElement>();
let location = $state('');
let backup=$state<{exportedAt:number;path:string;available:boolean}|null>(null),backupLoaded=$state(false);
let backupRequest = 0;
async function refreshBackup() {
  const request = ++backupRequest;
  try {
    const status = await desktop.backupStatus();
    if (request !== backupRequest) return;
    backup = status;
    backupLoaded = true;
  } catch (cause) {
    if (request === backupRequest) notify(`Could not read backup status: ${String(cause)}`, 'error');
  }
}
onMount(() => {
  void refreshBackup();
  const visible = () => { if (!document.hidden) void refreshBackup(); };
  window.addEventListener('focus', refreshBackup);
  window.addEventListener('invoice:file-location-error', refreshBackup);
  document.addEventListener('visibilitychange', visible);
  return () => {
    backupRequest++;
    window.removeEventListener('focus', refreshBackup);
    window.removeEventListener('invoice:file-location-error', refreshBackup);
    document.removeEventListener('visibilitychange', visible);
  };
});
let candidate = $state<{
  services: number;
  customers: number;
  drafts: number;
  issued: number;
} | null>(null);
onMount(() => {
  desktop
    .dataLocation()
    .then((path) => {
      location = path;
    })
    .catch((e) => {
      notify(String(e), 'error');
    });
});

async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (e) {
    notify(String(e), 'error');
  } finally {
    busy = false;
  }
}
function exportData() {
  return run(async () => {
    const path = await desktop.exportData();
    if(path)await refreshBackup();
    notify(path
      ? `All data exported to ${path}`
      : 'Export cancelled. No file was changed.', 'success', [], path ?? undefined);
  });
}
function chooseImport() {
  return run(async () => {
    candidate = null;
    candidate = await desktop.prepareImport();
    if(candidate){await tick();restoreDialog?.showModal();document.getElementById('replace-title')?.focus();}
    if (!candidate) notify('Import cancelled. Existing data is unchanged.');
  });
}
async function cancel() {
  if(busy)return;
  await run(async () => {
    await desktop.cancelImport();
    restoreDialog?.close();
    candidate = null;
    notify('Import cancelled. Existing data is unchanged.');
  });
  await tick();document.getElementById('choose-restore')?.focus();
}
async function confirm() {
  await run(async () => {
    try {
      const recovery = await desktop.confirmImport();
      notify(`All data restored. Previous data was retained at ${recovery}`, 'success', [], recovery);
    } finally {
      restoreDialog?.close();
      candidate = null;
    }
  });
  await tick();document.getElementById('choose-restore')?.focus();
}
</script><svelte:head><title>Data</title></svelte:head>


<div class="data-content">
<section class="panel panel-body" aria-labelledby="backup-status"><h2 id="backup-status">Backup status</h2>{#if !backupLoaded}<p>Loading backup status...</p>{:else if backup}<p>Last export: <strong>{new Date(backup.exportedAt).toLocaleString('en-AU')}</strong></p><p class="note">{backup.path}</p><FileLocation path={backup.path}/><div role="status">{#if backup.available}<p class="note">The export file is available. Changes made after this export are not backed up.</p>{:else}<p><strong>Backup unavailable</strong></p><p class="note">The last export couldn't be found at this location. Reconnect the drive or export a new backup.</p>{/if}</div>{:else}<p>No backup recorded on this computer.</p><p class="note">Your data is stored on this computer. Export a backup to another drive or a protected location.</p>{/if}</section>
<section class="panel" aria-labelledby="export-data-title"><div class="panel-heading"><h2 id="export-data-title">Export data</h2></div><div class="panel-body"><p>Back up your business, customers, services and invoices in a ZIP, including original PDFs and payment status.</p><Button class="primary" type="button" data-command="exportData" onclick={exportData} disabled={busy || candidate !== null}>Export all data</Button><p class="note card-note">Unencrypted private data. Keep exports in a secure location.</p><p class="note card-note">Theme, zoom and keyboard shortcuts are transferred separately in <a href="/settings/preferences">Preferences</a>.</p></div></section>
<section class="panel" aria-labelledby="restore-data-title"><div class="panel-heading"><h2 id="restore-data-title">Restore data</h2></div><div class="panel-body"><p>Replace current data from a ZIP export. Review its contents before confirming.</p><Button id="choose-restore" type="button" data-command="importData" onclick={chooseImport} disabled={busy || candidate !== null}>Choose export to restore</Button><p class="note card-note">Separate computers do not synchronise.</p></div></section>
<dialog bind:this={restoreDialog} data-shortcut-context="dialog" aria-labelledby="replace-title" aria-busy={busy} oncancel={event=>{event.preventDefault();void cancel();}}>{#if candidate}<h2 id="replace-title" tabindex="-1">Replace all current data?</h2><p>The validated file contains <strong>{candidate.customers} customers</strong>, <strong>{candidate.services} services</strong>, <strong>{candidate.drafts} drafts</strong> and <strong>{candidate.issued} issued invoices</strong>.</p><p>Your current workspace is saved as a recovery export first. A failed replacement leaves current data intact.</p><div class="actions"><Button data-command="close" type="button" onclick={cancel} disabled={busy}>Cancel import</Button><Button class="danger primary" type="button" onclick={confirm} disabled={busy}>Replace all data</Button></div>{/if}</dialog>
<details class="panel panel-body recovery"><summary>Recovery exports</summary><p>To undo a replacement, choose its recovery export above and review the confirmation. Recovery exports stay in the <code>recovery</code> subfolder until you remove them.</p><div class="storage-path"><span class="muted">Application data folder</span><code>{location || 'Loading…'}</code>{#if location}<div><FileLocation path={location} directory/></div>{/if}</div><p class="note card-note">Use Export all data for backups. Copying an open SQLite database can miss recent changes.</p></details>
<details class="panel panel-body licences"><summary>Fonts &amp; software licences</summary><p>Invoices embed IBM Plex Sans Regular and SemiBold under SIL Open Font License 1.1. Each PDF includes only the glyphs it uses, keeping files small and their appearance consistent without installing fonts. The application interface uses system fonts.</p><details><summary>IBM Plex Sans copyright &amp; full licence</summary><pre>{plexFontLicense}</pre></details><details><summary>PDF.js preview renderer · Apache 2.0</summary><pre>{pdfLicense}</pre></details><details><summary>Font subsetting · MIT &amp; third-party notices</summary><pre>{subsetterLicense}</pre></details><details><summary>Valibot validation · MIT</summary><pre>{validationLicense}</pre></details></details>
</div>
<style>
section[aria-labelledby="backup-status"] > [role="status"]{margin-top:calc(8rem / 13)}
.storage-path > div{margin-top:calc(4rem / 13)}
.data-content{display:flex;flex-direction:column;gap:calc(12rem / 13)}.data-content p{max-width:calc(760rem / 13)}.data-content p:not(.note){font-size:calc(12rem / 13)}.card-note{margin:calc(8rem / 13) 0 0}.storage-path{display:grid;gap:calc(4rem / 13);font-size:calc(11rem / 13)}.licences{font-size:calc(12rem / 13)}.licences details{margin-top:calc(8rem / 13)}pre{white-space:pre-wrap;font-size:calc(11rem / 13);max-height:20rem;overflow:auto}
</style>
