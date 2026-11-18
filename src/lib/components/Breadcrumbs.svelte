<script lang="ts">
let { current, parent }: {
  current: string;
  parent?: { href: string; label: string };
} = $props();
</script>

<nav class="breadcrumbs" aria-label="Breadcrumb">
  <ol>
    <li><a href="/invoices">Invoice</a></li>
    {#if parent}<li><span aria-hidden="true">›</span><a href={parent.href}>{parent.label}</a></li>{/if}
    <li><span aria-hidden="true">›</span><h1 aria-current="page">{current}</h1></li>
  </ol>
</nav>

<style>
.breadcrumbs{min-width:0;font-size:1rem;line-height:1.4}
ol{display:flex;align-items:center;flex-wrap:wrap;gap:calc(8rem / 13);list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;gap:calc(8rem / 13);min-width:0}
a,span{color:var(--muted)}
a{text-decoration:none}
a:hover{text-decoration:underline;color:var(--accent)}
h1{font:inherit;font-weight:600;letter-spacing:normal;color:var(--accent);margin:0}
</style>
