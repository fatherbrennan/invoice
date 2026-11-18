<script lang="ts">
let { name, size = 18 }: { name: string; size?: number } = $props();
const paths: Record<string, string> = {
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  restore: 'M8 8h11v11H8z M5 16V5h11',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  chevron: 'M6 9l6 6 6-6',
  services: 'M4 5h16v4H4z M4 15h16v4H4z M8 5v4 M8 15v4',
  invoices: 'M6 3h9l3 3v15H6z M10 9h4 M10 13h4 M10 17h4',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
  profile: 'M4 21V3h12v18 M2 21h20 M16 9h4v12 M8 7h4 M8 11h4 M8 15h4',
  data: 'M12 3v12 M8 7l4-4 4 4 M4 14v6h16v-6', plus: 'M12 5v14 M5 12h14', arrow: 'M5 12h14 M13 6l6 6-6 6', check: 'M5 12l4 4L19 6', close: 'M6 6l12 12 M18 6L6 18',
};
</script>
<svg width={size} height={size} style:width={`calc(${size}rem / 13)`} style:height={`calc(${size}rem / 13)`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true"><path d={paths[name] ?? paths.invoices} /></svg>
