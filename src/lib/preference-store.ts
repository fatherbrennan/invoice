import { writable } from 'svelte/store';
import { notify } from './notifications';
import {
  defaults,
  loadPreferences,
  type Preferences,
  savePreferences,
} from './preferences';

export const preferences = writable(defaults());
export function initializePreferences() {
  try {
    preferences.set(loadPreferences(localStorage));
  } catch (cause) {
    notify(`Could not load preferences: ${String(cause)}`, 'error');
  }
}
export function updatePreferences(value: Preferences): boolean {
  try {
    preferences.set(savePreferences(localStorage, value));
    return true;
  } catch (cause) {
    notify(`Could not save preferences: ${String(cause)}`, 'error');
    return false;
  }
}
