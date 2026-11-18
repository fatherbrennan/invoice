import {
  binding,
  commands,
  conflicts,
  type Overrides,
  type Platform,
  validBinding,
  zoomCommands,
} from './shortcuts.ts';

export type Preferences = {
  format: 'invoice-preferences';
  version: 1;
  theme: 'system' | 'light' | 'dark';
  zoom: number;
  invoiceView: 'pdf' | 'data';
  shortcuts: Record<Platform, Overrides>;
};
export const preferencesKey = 'invoice.preferences';
export const maxPreferencesBytes = 65536;
export const zoomLevels = [50, 75, 100, 125, 150, 175, 200];
export function defaults(): Preferences {
  return {
    format: 'invoice-preferences',
    version: 1,
    theme: 'system',
    zoom: 100,
    invoiceView: 'pdf',
    shortcuts: { windows: {}, mac: {} },
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
export function parsePreferences(text: string): Preferences {
  if (new TextEncoder().encode(text).length > maxPreferencesBytes)
    throw new Error('Preferences file exceeds 64 KiB.');
  const value: unknown = JSON.parse(text);
  if (
    !object(value) ||
    !exactKeys(value, [
      'format',
      'version',
      'theme',
      'invoiceView',
      'shortcuts',
      ...(Object.hasOwn(value, 'zoom')
        ? ['zoom']
        : Object.hasOwn(value, 'fontSize')
          ? ['fontSize']
          : []),
    ]) ||
    value.format !== 'invoice-preferences' ||
    value.version !== 1
  )
    throw new Error('Unsupported Invoice preferences file or version.');
  if (
    typeof value.theme !== 'string' ||
    !['system', 'light', 'dark'].includes(value.theme) ||
    typeof value.invoiceView !== 'string' ||
    !['pdf', 'data'].includes(value.invoiceView)
  )
    throw new Error('Invalid theme or invoice view.');
  const legacy = !Object.hasOwn(value, 'zoom');
  if (Object.hasOwn(value, 'fontSize')) {
    if (
      typeof value.fontSize !== 'number' ||
      !Number.isInteger(value.fontSize) ||
      value.fontSize < 12 ||
      value.fontSize > 20
    )
      throw new Error('Invalid legacy font size.');
    // Keep the closest available zoom to the former 13 px baseline.
    value.zoom = Math.round(((value.fontSize / 13) * 100) / 25) * 25;
    delete value.fontSize;
  } else if (legacy) value.zoom = 100;
  if (typeof value.zoom !== 'number' || !zoomLevels.includes(value.zoom))
    throw new Error('Invalid zoom level.');
  if (
    !object(value.shortcuts) ||
    !exactKeys(value.shortcuts, ['windows', 'mac'])
  )
    throw new Error('Both Windows and macOS shortcut maps are required.');
  for (const platform of ['windows', 'mac'] as const) {
    const overrides = value.shortcuts[platform];
    if (!object(overrides)) throw new Error('Invalid shortcut map.');
    for (const [id, key] of Object.entries(overrides)) {
      if (
        !commands.some((command) => command.id === id) ||
        (key !== null && (typeof key !== 'string' || !validBinding(key)))
      )
        throw new Error(`Invalid shortcut: ${id}.`);
    }
    if (legacy)
      for (const zoom of zoomCommands) {
        // Existing custom shortcuts take priority over new default bindings.
        if (
          !Object.hasOwn(overrides, zoom.id) &&
          commands.some(
            (other) =>
              other.id !== zoom.id &&
              binding(other, platform, overrides as Overrides) ===
                zoom[platform],
          )
        )
          overrides[zoom.id] = null;
      }
    const errors = conflicts(platform, overrides as Overrides);
    if (errors.length)
      throw new Error(
        `${platform === 'mac' ? 'macOS' : 'Windows'}: ${errors[0]}`,
      );
  }
  return value as Preferences;
}
export function savePreferences(
  storage: Pick<Storage, 'setItem'>,
  value: Preferences,
): Preferences {
  const validated = parsePreferences(JSON.stringify(value));
  storage.setItem(preferencesKey, JSON.stringify(validated));
  return validated;
}
export function loadPreferences(
  storage: Pick<Storage, 'getItem'>,
): Preferences {
  const saved = storage.getItem(preferencesKey);
  if (saved !== null) return parsePreferences(saved);
  return defaults();
}
export function overrideCount(value: Preferences, platform: Platform): number {
  return commands.filter(
    (command) =>
      binding(command, platform, value.shortcuts[platform]) !==
      command[platform],
  ).length;
}
