export function positionDropdown(node: HTMLElement, anchor: HTMLElement) {
  function place() {
    const bounds = anchor.getBoundingClientRect();
    const bottom =
      document.querySelector('.shortcut-bar')?.getBoundingClientRect().top ??
      innerHeight;
    const below = bottom - bounds.bottom - 6;
    const above = bounds.top - 8;
    const upwards = below < 180 && above > below;
    node.style.position = 'fixed';
    node.style.width = `${Math.min(Math.max(bounds.width, 240), innerWidth - 16)}px`;
    node.style.left = `${Math.max(8, Math.min(bounds.left, innerWidth - node.offsetWidth - 8))}px`;
    node.style.maxHeight = `${Math.max(64, upwards ? above : below)}px`;
    node.style.top = upwards ? 'auto' : `${bounds.bottom}px`;
    node.style.bottom = upwards ? `${innerHeight - bounds.top}px` : 'auto';
  }
  place();
  const resize = new ResizeObserver(place);
  resize.observe(anchor);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);
  return {
    destroy() {
      resize.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    },
  };
}
