import { type Command, type Context, commands } from './shortcuts';

export type AvailableCommand = {
  command: Command;
  target: HTMLElement;
  disabled: boolean;
};
function visible(node: HTMLElement) {
  return (
    node.isConnected &&
    node.getClientRects().length > 0 &&
    !node.closest('[hidden], [inert]')
  );
}
export function activeCommands(focused: Element | null): {
  label: string;
  context: Context;
  items: AvailableCommand[];
} {
  const modal = [
    ...document.querySelectorAll<HTMLDialogElement>('dialog[open]'),
  ].at(-1);
  const main = document.querySelector<HTMLElement>('main');
  let scope = focused?.closest<HTMLElement>('[data-shortcut-context]');
  if (modal)
    scope = focused && modal.contains(focused) ? (scope ?? modal) : modal;
  else if (
    !scope ||
    scope === main ||
    !visible(scope) ||
    !main?.contains(scope)
  )
    scope = main?.querySelector<HTMLElement>('[data-shortcut-default]') ?? main;
  const label = modal
    ? (modal.getAttribute('aria-label') ??
      document.getElementById(modal.getAttribute('aria-labelledby') ?? '')
        ?.textContent ??
      'Dialog')
    : (scope?.dataset.shortcutLabel ?? 'Workspace');
  const activeContext = (scope?.dataset.shortcutContext ??
    (modal ? 'dialog' : 'page')) as Context;
  const items: AvailableCommand[] = [];
  while (scope) {
    const context = (scope.dataset.shortcutContext ??
      (scope === modal ? 'dialog' : 'page')) as Context;
    for (const command of commands) {
      if (
        !command.contexts.includes(context) ||
        items.some((item) => item.command.id === command.id)
      )
        continue;
      const targetId = command.aliasFor ?? command.id;
      const target = [
        ...scope.querySelectorAll<HTMLElement>(`[data-command="${targetId}"]`),
      ].find(
        (node) =>
          visible(node) &&
          (node.closest('[data-shortcut-context]') === scope ||
            (targetId === 'search' && context === 'page')),
      );
      if (target)
        items.push({
          command,
          target,
          disabled: target.matches(':disabled, [aria-disabled="true"]'),
        });
    }
    if (scope === modal) break;
    scope =
      scope.parentElement?.closest<HTMLElement>('[data-shortcut-context]') ??
      null;
  }
  if (!modal)
    for (const command of commands.filter((item) =>
      item.contexts.includes('global'),
    )) {
      const target = document.querySelector<HTMLElement>(
        `[data-command="${command.id}"]`,
      );
      if (target && visible(target))
        items.push({ command, target, disabled: false });
    }
  return { label: label.trim(), context: activeContext, items };
}
export function executeCommand(item: AvailableCommand) {
  if (
    item.disabled ||
    !visible(item.target) ||
    item.target.matches(':disabled, [aria-disabled="true"]')
  )
    return;
  if (item.target instanceof HTMLInputElement) {
    item.target.focus();
    item.target.select();
  } else item.target.click();
}
