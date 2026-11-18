<script lang="ts">
import { onMount } from 'svelte';

type Bar = { id:string; node:HTMLElement; vertical:boolean; x:number; y:number; length:number; thumb:number; position:number; max:number; value:number; page:number; label:string };
let bars = $state.raw<Bar[]>([]);
let layer: HTMLDivElement;
const selectors = '.page-content, .scroll-region, .table-scroll, .master-detail > .panel, .ledger, .ledger > .panel, .editor-layout > *, .suggestions [role="listbox"], dialog[open], textarea, .toast-host, .shortcut-actions, pre';
function scroll(bar:Bar, value:number) {
  if(bar.vertical) bar.node.scrollTop=value; else bar.node.scrollLeft=value;
}
function drag(event:PointerEvent, bar:Bar) {
  event.preventDefault(); event.stopPropagation();
  const target=event.currentTarget as HTMLElement;
  const point=()=>bar.vertical?event.clientY-bar.y:event.clientX-bar.x;
  if(!(event.target as HTMLElement).closest('.scroll-thumb')) scroll(bar, (point()-bar.thumb/2)/(bar.length-bar.thumb)*bar.max);
  const start=bar.vertical?event.clientY:event.clientX;
  const value=bar.vertical?bar.node.scrollTop:bar.node.scrollLeft;
  target.setPointerCapture(event.pointerId);
  const move=(next:PointerEvent)=>scroll(bar, value+((bar.vertical?next.clientY:next.clientX)-start)/(bar.length-bar.thumb)*bar.max);
  const stop=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('lostpointercapture',stop);};
  target.addEventListener('pointermove',move); target.addEventListener('lostpointercapture',stop);
}
function key(event:KeyboardEvent, bar:Bar) {
  const deltas:Record<string,number>={ArrowDown:40,ArrowRight:40,ArrowUp:-40,ArrowLeft:-40,PageDown:bar.page,PageUp:-bar.page,Home:-bar.max,End:bar.max};
  if(!(event.key in deltas))return;
  event.preventDefault();event.stopPropagation();scroll(bar,bar.value+deltas[event.key]);
}
onMount(()=>{
  let frame=0, sequence=0, signature='';
  const observed=new Set<Element>();
  const resize=new ResizeObserver(schedule);
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  function measure(){
    frame=0;
    const modal=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    const parent=modal ?? document.body;
    if(layer.parentElement!==parent)parent.appendChild(layer);
    const nodes=[...document.querySelectorAll<HTMLElement>(selectors)].filter(node=>!node.closest('.scrollbar-layer') && (!modal || modal.contains(node)));
    for(const node of observed)if(!nodes.includes(node as HTMLElement)){resize.unobserve(node);observed.delete(node);}
    const next:Bar[]=[];
    const bottomLimit=document.querySelector('.shortcut-bar')?.getBoundingClientRect().top ?? innerHeight;
    for(const node of nodes){
      if(!observed.has(node)){resize.observe(node);observed.add(node);}
      const rect=node.getBoundingClientRect(), css=getComputedStyle(node);
      if(!rect.width || !rect.height || node.closest('details:not([open])') || css.visibility==='hidden')continue;
      let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(bottomLimit,rect.bottom);
      for(let ancestor=node.parentElement;ancestor;ancestor=ancestor.parentElement){
        const style=getComputedStyle(ancestor), clip=ancestor.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
        if(style.position==='fixed')break;
      }
      if(right-left<16 || bottom-top<16)continue;
      for(const vertical of [true,false]){
        if(!/auto|scroll/.test(vertical?css.overflowY:css.overflowX))continue;
        const page=vertical?node.clientHeight:node.clientWidth, extent=vertical?node.scrollHeight:node.scrollWidth, max=extent-page;
        if(max<=1)continue;
        if(!node.id)node.id=`scroll-region-${++sequence}`;
        const length=(vertical?bottom-top:right-left)-4;
        const thumb=Math.min(length-4,Math.max(24,length*page/extent));
        const value=Math.max(0,Math.min(max,vertical?node.scrollTop:node.scrollLeft));
        next.push({id:`${node.id}-${vertical?'y':'x'}`,node,vertical,x:vertical?right-10:left+2,y:vertical?top+2:bottom-10,length,thumb,position:value/max*(length-thumb),max,value,page,label:node.getAttribute('aria-label') ?? 'Section'});
      }
    }
    const stamp=JSON.stringify(next.map(({node,...bar})=>bar));
    if(stamp!==signature){signature=stamp;bars=next;}
  }
  const mutations=new MutationObserver(schedule);
  mutations.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
  document.addEventListener('scroll',schedule,true);document.addEventListener('load',schedule,true);window.addEventListener('resize',schedule);
  schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();document.removeEventListener('scroll',schedule,true);document.removeEventListener('load',schedule,true);window.removeEventListener('resize',schedule);layer.remove();};
});
</script>
<div class="scrollbar-layer" bind:this={layer}>
  {#each bars as bar (bar.id)}
    <div class="scroll-track" class:vertical={bar.vertical} role="scrollbar" tabindex="0" aria-label={`${bar.label}: ${bar.vertical?'vertical':'horizontal'} scroll`} aria-controls={bar.node.id} aria-orientation={bar.vertical?'vertical':'horizontal'} aria-valuemin={0} aria-valuemax={Math.round(bar.max)} aria-valuenow={Math.round(bar.value)} style:left={`${bar.x}px`} style:top={`${bar.y}px`} style:width={`${bar.vertical?10:bar.length}px`} style:height={`${bar.vertical?bar.length:10}px`} onpointerdown={event=>drag(event,bar)} onkeydown={event=>key(event,bar)}>
      <div class="scroll-thumb" style:top={bar.vertical?`${bar.position}px`:'2px'} style:left={bar.vertical?'2px':`${bar.position}px`} style:height={bar.vertical?`${bar.thumb}px`:'6px'} style:width={bar.vertical?'6px':`${bar.thumb}px`}></div>
    </div>
  {/each}
</div>
<style>
.scrollbar-layer{position:fixed;inset:0;z-index:50;pointer-events:none}.scroll-track{position:fixed;pointer-events:auto;touch-action:none;outline-offset:-2px;opacity:1}.scroll-track:hover,.scroll-track:focus-visible{opacity:1;background:var(--soft)}.scroll-thumb{position:absolute;background:var(--line-strong)}
@media(forced-colors:active){.scroll-thumb{forced-color-adjust:none;background:CanvasText}.scroll-track:focus-visible{outline:2px solid Highlight}}
</style>
