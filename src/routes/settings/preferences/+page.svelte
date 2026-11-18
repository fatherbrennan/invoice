<script lang="ts">
import { onMount, tick } from 'svelte';
import { page } from '$app/state';
import { Button, Field } from '../../../lib/components/ui';
import { desktop } from '../../../lib/desktop';
import { notify } from '../../../lib/notifications';
import { preferences, updatePreferences } from '../../../lib/preference-store';
import { overrideCount, type Preferences, parsePreferences, zoomLevels } from '../../../lib/preferences';
import { binding, type Command, commands, conflicts, displayBinding, keyBinding, type Platform, validBinding } from '../../../lib/shortcuts';

const contextLabels={global:'Anywhere',page:'Workspace',editor:'Editing',dialog:'Dialog',list:'Records',detail:'Invoice details',preview:'PDF preview',picker:'Selection',preferences:'Preferences'};
let shortcutsOpen=$state(false);
$effect(()=>{if(page.url.hash==='#shortcuts')shortcutsOpen=true;});
let platform = $state<Platform>('windows');
let query = $state('');
let modifiedOnly = $state(false);
let busy = $state(false);
let candidate = $state<Preferences | null>(null);
let importDialog: HTMLDialogElement;
let recorder: HTMLDialogElement;
let recording = $state<Command | null>(null);
let recorded = $state<string | null>(null);
let recordingError = $state('');

onMount(() => { shortcutsOpen=location.hash==='#shortcuts';platform = /Mac/i.test(navigator.platform) ? 'mac' : 'windows'; });
const filtered = $derived(commands.filter(command => {
  const key = binding(command, platform, $preferences.shortcuts[platform]);
  return (!modifiedOnly || key !== command[platform]) && `${command.label} ${displayBinding(key, platform)} ${command.contexts.map(context=>`${context} ${contextLabels[context]}`).join(' ')}`.toLowerCase().includes(query.toLowerCase());
}));
const problems = $derived(recording ? conflicts(platform, {...$preferences.shortcuts[platform], [recording.id]: recorded}) : []);
function setTheme(value: string) { updatePreferences({...$preferences, theme: value as Preferences['theme']}); }
function setZoom(value: string) { updatePreferences({...$preferences, zoom: Number(value)}); }
function setView(value: string) { updatePreferences({...$preferences, invoiceView: value as Preferences['invoiceView']}); }
async function edit(command: Command) {
  recording = command; recorded = binding(command, platform, $preferences.shortcuts[platform]); recordingError = '';
  recorder.showModal(); await tick(); document.getElementById('record-key')?.focus();
}
function capture(event: KeyboardEvent) {
  if ((event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) || event.key === 'Escape') return;
  event.preventDefault(); event.stopPropagation();
  if (event.isComposing || event.repeat) return;
  const value = keyBinding(event);
  if (!value) return;
  if (!validBinding(value) || event.getModifierState('AltGraph')) { recordingError = 'Use Ctrl, Command or Alt with a key, a function key, or /. Slash only runs outside fields.'; return; }
  recorded = value; recordingError = '';
}
function saveBinding() {
  if (!recording || recordingError || problems.length) return;
  const overrides = {...$preferences.shortcuts[platform], [recording.id]: recorded};
  if (recorded === recording[platform]) delete overrides[recording.id];
  if (updatePreferences({...$preferences, shortcuts: {...$preferences.shortcuts, [platform]: overrides}})) recorder.close();
}
function reset(command: Command) {
  const overrides = {...$preferences.shortcuts[platform]}; delete overrides[command.id];
  updatePreferences({...$preferences, shortcuts: {...$preferences.shortcuts, [platform]: overrides}});
}
async function transfer(action: 'export' | 'import') {
  if (busy) return;
  busy = true;
  try {
    if (action === 'export') {
      const path = await desktop.exportPreferences(JSON.stringify($preferences, null, 2));
      if (path) notify(`Preferences exported to ${path}`, 'success', [], path);
    } else {
      const contents = await desktop.importPreferences();
      if (contents !== null) { candidate = parsePreferences(contents); importDialog.showModal(); }
    }
  } catch (cause) { notify(String(cause), 'error'); }
  finally { busy = false; }
}
function applyImport() {
  if (candidate && updatePreferences(candidate)) { importDialog.close(); candidate = null; notify('Preferences imported.'); }
}
</script>
<svelte:head><title>Preferences</title></svelte:head>
<div class="preferences-content" data-shortcut-context="preferences" data-shortcut-label="Preferences" data-shortcut-default>
  <section class="panel appearance" aria-labelledby="appearance-title">
    <div class="panel-heading"><h2 id="appearance-title">Appearance</h2><span class="note">Changes save automatically</span></div>
    <div class="panel-body form-grid">
      <Field id="theme" label="Theme" kind="select" bind:value={()=> $preferences.theme, setTheme} options={[{value:'system',label:'System'},{value:'light',label:'Light'},{value:'dark',label:'Dark'}]}/>
      <Field id="zoom" label="Zoom" kind="select" bind:value={()=> String($preferences.zoom), setZoom} options={zoomLevels.map(zoom=>({value:String(zoom),label:`${zoom}%`}))} hint="Scales app text and controls. Invoice PDFs keep their own font sizes."/>
      <Field id="invoice-view" label="Default invoice view" kind="select" bind:value={()=> $preferences.invoiceView, setView} options={[{value:'pdf',label:'PDF preview'},{value:'data',label:'Invoice details'}]}/>
    </div>
  </section>
  <details class="panel shortcuts" bind:open={shortcutsOpen}><summary id="shortcuts">Advanced keyboard shortcuts</summary>
    <div class="panel-heading"><h2 id="shortcut-bindings-title">Keyboard shortcuts</h2><span class="note">{platform==='mac'?'macOS':'Windows'} bindings</span></div>
    <div class="toolbar">
      <Field command="search" id="shortcut-search" label="Search commands, keys or context" type="search" bind:value={query}/>
      <Field id="shortcut-platform" label="Platform" kind="select" bind:value={platform} options={[{value:'windows',label:'Windows'},{value:'mac',label:'macOS'}]}/>
      <Field id="modified-only" label="Modified only" kind="checkbox" bind:checked={modifiedOnly}/>
    </div>
    <p class="note shortcut-note">Select a binding to record new keys. Context follows the focused section; dialogs take priority. Text-editing shortcuts stay with the field. / searches only outside fields; change or unassign Search (alternate) to customise it.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal table scrolling.) -->
    <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access to horizontal table scrolling. -->
    <section class="table-scroll" aria-label="Keyboard bindings table" tabindex="0"><table><thead><tr><th scope="col">Command</th><th scope="col">Keybinding</th><th scope="col">When</th><th scope="col">Source</th><th scope="col"><span class="sr-only">Reset</span></th></tr></thead><tbody>
      {#each filtered as command (command.id)}
        {@const key = binding(command, platform, $preferences.shortcuts[platform])}
        {@const modified = key !== command[platform]}
        <tr><th scope="row">{command.label}</th><td><Button type="button" class="binding" aria-label={`Change ${command.label} shortcut`} onclick={()=>void edit(command)}><kbd>{displayBinding(key, platform)}</kbd></Button></td><td class="muted">{command.contexts.map(context=>contextLabels[context]).join(', ')}</td><td><span class="badge">{modified?'User':'Default'}</span></td><td><Button type="button" class="quiet" disabled={!modified} aria-label={`Reset ${command.label} shortcut`} onclick={()=>reset(command)}>Reset</Button></td></tr>
      {/each}
    </tbody></table>{#if !filtered.length}<p class="empty">No matching shortcuts.</p>{/if}</section>
  </details>
  <section class="panel transfer" aria-labelledby="transfer-title">
    <div class="panel-heading"><h2 id="transfer-title">Transfer preferences</h2></div>
    <div class="panel-body transfer-content"><p class="note">Theme, zoom, invoice view and both platforms’ shortcut overrides. Business data and invoices are transferred from the Data screen.</p>
    <div class="actions"><Button data-command="exportPreferences" type="button" disabled={busy} onclick={()=>void transfer('export')}>Export preferences</Button><Button data-command="importPreferences" type="button" disabled={busy} onclick={()=>void transfer('import')}>Import preferences…</Button></div>
    </div>
  </section>
</div>
<dialog data-shortcut-context="dialog" data-shortcut-recorder bind:this={recorder} aria-labelledby="record-title" onclose={()=>recording=null}>
  <h2 id="record-title">{recording?.label} · {platform==='mac'?'macOS':'Windows'}</h2>
  <p>Focus the field and press your new combination.</p>
  <Field id="record-key" label="New keybinding" value={displayBinding(recorded, platform)} readonly onkeydown={capture}/>
  <p id="binding-feedback" class="record-feedback" role="status">{recordingError || problems.join(' ') || 'Tab moves to the actions. Escape cancels.'}</p>
  <div class="actions"><Button type="button" onclick={()=>{recorded=null;recordingError='';}}>Unassign</Button><Button type="button" data-tooltip-keys="Escape" onclick={()=>recorder.close()}>Cancel</Button><Button class="primary" type="button" disabled={!!recordingError || !!problems.length} onclick={saveBinding}>Apply</Button></div>
</dialog>
<dialog data-shortcut-context="dialog" bind:this={importDialog} aria-labelledby="import-preferences-title" onclose={()=>candidate=null}>
  <h2 id="import-preferences-title">Replace preferences?</h2>
  {#if candidate}<p>Theme: <strong>{candidate.theme}</strong> · Zoom: <strong>{candidate.zoom}%</strong> · Invoice view: <strong>{candidate.invoiceView==='pdf'?'PDF preview':'Invoice details'}</strong></p><p>{overrideCount(candidate,'windows')} Windows and {overrideCount(candidate,'mac')} macOS shortcut overrides.</p>{/if}
  <p>This replaces your current preferences. Export them first if you want to keep a copy.</p>
  <div class="actions"><Button data-command="close" type="button" onclick={()=>importDialog.close()}>Cancel</Button><Button class="primary" type="button" onclick={applyImport}>Replace preferences</Button></div>
</dialog>
<style>


.appearance .form-grid{max-width:calc(700rem / 13)}.shortcut-note{padding:0 calc(12rem / 13) calc(12rem / 13);margin:0}.shortcuts :global(.binding){min-width:10rem;justify-content:flex-start}.shortcuts td,.shortcuts th{padding:calc(3rem / 13) calc(12rem / 13)}.shortcuts :global(button){min-height:calc(24rem / 13);padding:calc(2rem / 13) calc(6rem / 13);font-size:calc(11rem / 13)}kbd{font:calc(12rem / 13) system-ui}.transfer-content{display:flex;align-items:center;justify-content:space-between;gap:calc(12rem / 13)}.transfer p{margin:0;max-width:calc(600rem / 13)}.record-feedback{margin:calc(10rem / 13) 0;color:var(--muted);font-size:calc(12rem / 13)}dialog{width:calc(440rem / 13)}@container app (max-width: calc(800rem / 13)){.transfer-content{align-items:start;flex-direction:column}.shortcuts .toolbar{flex-wrap:wrap}}
.preferences-content{display:flex;flex-direction:column;flex:none;gap:calc(12rem / 13)}.preferences-content>.panel{flex-shrink:0}.shortcuts>summary{padding:calc(12rem / 13);font-weight:600}.shortcuts>.table-scroll{max-height:45dvh;flex:none}
</style>
