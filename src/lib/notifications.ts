import { writable } from 'svelte/store';

export type Notification = {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
  links: { href: string; label: string }[];
  filePath?: string;
};

export const notifications = writable<Notification[]>([]);
let nextId = 0;

export function notify(
  message: string,
  kind: Notification['kind'] = 'success',
  links: Notification['links'] = [],
  filePath?: string,
) {
  const id = ++nextId;
  notifications.update((items) => [
    ...items.filter((item) => item.message !== message || item.kind !== kind),
    { id, message, kind, links, filePath },
  ]);
  return message;
}

export function dismissNotification(id: number) {
  notifications.update((items) => items.filter((item) => item.id !== id));
}
