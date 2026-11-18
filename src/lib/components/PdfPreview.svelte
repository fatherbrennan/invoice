<script lang="ts">
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { notify } from '../notifications';
import Icon from './Icon.svelte';
import { Button } from './ui';

GlobalWorkerOptions.workerSrc = workerUrl;
let { pdf = '', label = 'Invoice preview', pending = false, stale = false, message = 'Select an invoice to see its PDF.' }: { pdf?: string; label?: string; pending?: boolean; stale?: boolean; message?: string } = $props();
let document = $state.raw<PDFDocumentProxy | null>(null);
let canvas = $state<HTMLCanvasElement>();
let pageNumber = $state(1);
let error = $state('');
let rendering = $state(false), loading = $state(false), renderedPage = $state(1);
let rendered = $state(false);
let zoomDialog = $state<HTMLDialogElement>();
let zoomImage = $state('');
function expand() {
  if (!canvas || !rendered) return;
  zoomImage = canvas.toDataURL('image/png');
  zoomDialog?.showModal();
}
$effect(() => {
  const bytes = pdf;
  document = null;
  pageNumber = 1;
  error = '';
  loading=!!bytes;rendering=false;
  if (!bytes) {rendered=false;rendering=false;return;}
  let cancelled = false;
  const task = getDocument({ data: Uint8Array.from(atob(bytes), c => c.charCodeAt(0)), useSystemFonts: false });
  void task.promise.then(value => { if (!cancelled) {document = value;loading=false;} }).catch(cause => { if (!cancelled) {loading=false;error = notify(`Preview unavailable: ${String(cause)}`, 'error');} });
  return () => { cancelled = true; void task.destroy(); };
});
$effect(() => {
  const source = document;
  const target = canvas;
  const number = pageNumber;
  if (!source || !target) return;
  let cancelled = false;
  let task: RenderTask | undefined;
  rendering = true;
  void (async () => {
    try {
      const page = await source.getPage(number);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.7 });
      const buffer = target.ownerDocument.createElement('canvas');
      buffer.width = Math.ceil(viewport.width);
      buffer.height = Math.ceil(viewport.height);
      task = page.render({ canvas: buffer, viewport, annotationMode: 0 });
      await task.promise;
      if (!cancelled) {
        target.width=buffer.width;target.height=buffer.height;
        target.getContext('2d')?.drawImage(buffer,0,0);
        renderedPage=number;rendered=true;
      }
    } catch (cause) { if (!cancelled) error = notify(`Preview unavailable: ${String(cause)}`, 'error'); }
    finally { if (!cancelled) rendering = false; }
  })();
  return () => { cancelled = true; task?.cancel(); };
});
</script>
<section data-shortcut-context="preview" data-shortcut-label="PDF preview" class="pdf-preview" aria-label={label} aria-busy={pending || loading || rendering}>
  {#if pdf && (pending || loading || rendering || error || (stale && message))}<p class="preview-updating" role="status">{pending || loading || rendering ? "Updating preview..." : error ? "Preview unavailable. The last rendered page is shown." : message}</p>{/if}
  {#if document || rendered}
    <div class="preview-tools">
      {#if document}
        <div class="pager"><Button class="icon-button" data-command="previousPage" type="button" onclick={() => pageNumber--} disabled={loading || rendering || pageNumber <= 1} aria-label="Previous preview page"><Icon name="left" size={16}/></Button><span>Page {pageNumber} of {document.numPages}</span><Button class="icon-button" data-command="nextPage" type="button" onclick={() => pageNumber++} disabled={loading || rendering || pageNumber >= document.numPages} aria-label="Next preview page"><Icon name="right" size={16}/></Button></div>
      {/if}
      <Button type="button" data-command="expandPreview" onclick={expand} disabled={!rendered || pending || loading || rendering} aria-label="Expand PDF preview">Expand</Button>
    </div>
  {/if}
  <div class="paper-area">
    {#if error && !rendered}<div class="placeholder"><p>Preview unavailable.</p></div>{:else if !pdf}
      <div class="placeholder"><p>{pending ? 'Preparing your invoice…' : message}</p></div>
    {:else}
      {#if !rendered}<p class="render-note">Rendering page…</p>{/if}
      <canvas bind:this={canvas} class:ready={rendered} aria-label={`${label}, page ${renderedPage} of ${document?.numPages ?? 1}`} data-rendered={rendered}>PDF preview. Use Open PDF for the full document.</canvas>
    {/if}
  </div>
</section>
<dialog data-shortcut-context="dialog" class="zoom-dialog" bind:this={zoomDialog} aria-label="Expanded PDF preview" onclose={() => zoomImage = ''}>
  <div class="zoom-toolbar"><span>{label} · Page {pageNumber}</span><Button data-command="close" type="button" onclick={() => zoomDialog?.close()}>Close preview</Button></div>
  {#if zoomImage}<img src={zoomImage} alt={`${label}, page ${pageNumber}. Use Open PDF to read the full document.`} />{/if}
</dialog>
<style>
.preview-updating{font-size:calc(12rem / 13);margin:0 0 calc(6rem / 13);color:var(--muted)}
.preview-tools{display:flex;align-items:center;justify-content:flex-end;gap:calc(8rem / 13);margin-bottom:calc(6rem / 13)}
.pdf-preview { border:0; background:transparent; overflow:visible; }
.paper-area { padding:calc(8rem / 13); position:relative; background:var(--surface); border:1px solid var(--line); }
canvas { display: block; width: auto; max-width: 100%; height: auto; max-height: var(--pdf-preview-max-height, none); margin-inline: auto; background: white; opacity: 0; }
canvas.ready { opacity: 1; }
.placeholder {min-height:calc(160rem / 13);display:grid;place-items:center;color:var(--muted);font-size:calc(12rem / 13);text-align:center;padding:calc(16rem / 13);}
.pager { display: flex; align-items: center; gap: calc(4rem / 13); margin-right:auto; white-space:nowrap; color: var(--muted); font-size: calc(12rem / 13); }
.pager :global(button) { min-height: calc(32rem / 13); }
.render-note { position: absolute; top: calc(35rem / 13); left: calc(25rem / 13); right: calc(25rem / 13); font-size: calc(12rem / 13); color: var(--muted); }

.zoom-dialog { padding:0; border:1px solid var(--line); border-radius:0; width:min(calc(1000rem / 13),96vw); max-width:96vw; max-height:92vh; background:var(--surface); }

.zoom-toolbar { position:sticky; top:0; background:var(--paper); display:flex; align-items:center; justify-content:space-between; gap:calc(12rem / 13); padding:calc(10rem / 13) calc(16rem / 13); font-size:calc(12rem / 13); }
.zoom-dialog img { display:block; width:calc(100% - calc(32rem / 13)); height:auto; margin:calc(16rem / 13); background:white; }
</style>
