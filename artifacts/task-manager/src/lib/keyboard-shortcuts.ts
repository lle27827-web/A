import { useEffect, useRef } from 'react';

export type KeyboardShortcutAction = {
  id: string;
  label: string;
  run: () => void;
};

export type KeyboardShortcutBindings = Record<string, string>;

const STORAGE_KEY = 'so-cong:keyboard-shortcuts:v1';
const CHANGE_EVENT = 'so-cong:keyboard-shortcuts-change';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

function parseCombination(combination: string): { modifiers: Modifier[]; key: string } | null {
  const parts = combination.split('+');
  const key = parts.pop()?.toUpperCase() ?? '';
  const modifiers = parts as Modifier[];
  if (!/^[A-Z0-9]$/.test(key) || !modifiers.length) return null;
  if (modifiers.some((modifier) => !MODIFIERS.includes(modifier))) return null;
  if (new Set(modifiers).size !== modifiers.length) return null;
  return { modifiers, key };
}

function normalizeCombination(combination: string): string | null {
  const parsed = parseCombination(combination);
  if (!parsed) return null;
  const modifiers = MODIFIERS.filter((modifier) => parsed.modifiers.includes(modifier));
  return [...modifiers, parsed.key].join('+');
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const physicalKey = event.code.match(/^(?:Key([A-Z])|Digit([0-9])|Numpad([0-9]))$/);
  const key = physicalKey?.[1] ?? physicalKey?.[2] ?? physicalKey?.[3] ?? (/^[a-zA-Z0-9]$/.test(event.key) ? event.key.toUpperCase() : '');
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  if (!modifiers.length) return null;
  return [...modifiers, key].join('+');
}

export function blockedShortcutReason(combination: string): string | null {
  const parsed = parseCombination(combination);
  if (!parsed) return 'Chỉ dùng tổ hợp có phím bổ trợ cùng một chữ hoặc số.';
  const { modifiers, key } = parsed;
  if (modifiers.includes('Meta')) {
    return 'Không dùng phím ⌘/Meta để giữ nguyên phím tắt hệ thống và trợ năng.';
  }
  if (modifiers.includes('Ctrl') && modifiers.includes('Alt')) {
    return 'Không dùng Ctrl+Alt vì tổ hợp này có thể điều khiển VoiceOver.';
  }
  if (modifiers.includes('Alt') && modifiers.includes('Shift')) {
    return 'Không dùng Alt+Shift vì hệ điều hành có thể dùng để đổi ngôn ngữ bàn phím.';
  }
  if (modifiers.includes('Ctrl')) {
    if (!modifiers.includes('Shift') || !/^[0-9]$/.test(key)) {
      return 'Tổ hợp Ctrl thông dụng thường do trình duyệt hoặc hệ điều hành giữ lại.';
    }
    return null;
  }
  if (!modifiers.includes('Alt')) return 'Dùng Alt cùng chữ/số hoặc Ctrl+Shift cùng số.';
  if (modifiers.includes('Alt') && key === 'F') {
    return 'Alt+F thường mở menu của trình duyệt.';
  }
  return null;
}

export function isSupportedShortcut(combination: string): boolean {
  return blockedShortcutReason(combination) === null;
}

export function formatShortcutLabel(combination: string): string {
  return combination.replaceAll('Meta', '⌘');
}

function isBindings(value: unknown): value is KeyboardShortcutBindings {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readDeviceShortcutBindings(): KeyboardShortcutBindings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isBindings(parsed)) return {};
    const result: KeyboardShortcutBindings = {};
    const used = new Set<string>();
    for (const [actionId, combination] of Object.entries(parsed)) {
      if (!/^[a-z0-9-]{1,80}$/i.test(actionId) || typeof combination !== 'string') continue;
      const normalized = normalizeCombination(combination);
      if (!normalized || !isSupportedShortcut(normalized) || used.has(normalized)) continue;
      result[actionId] = normalized;
      used.add(normalized);
    }
    return result;
  } catch {
    return {};
  }
}

export function writeDeviceShortcutBindings(bindings: KeyboardShortcutBindings): boolean {
  try {
    const safe: KeyboardShortcutBindings = {};
    const used = new Set<string>();
    for (const [actionId, combination] of Object.entries(bindings)) {
      const normalized = normalizeCombination(combination);
      if (!/^[a-z0-9-]{1,80}$/i.test(actionId) || !normalized || !isSupportedShortcut(normalized) || used.has(normalized)) continue;
      safe[actionId] = normalized;
      used.add(normalized);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [role="slider"]',
  ));
}

export function useDeviceKeyboardShortcuts(actions: KeyboardShortcutAction[]): void {
  const actionRef = useRef(actions);
  const bindingsRef = useRef<KeyboardShortcutBindings>(readDeviceShortcutBindings());
  actionRef.current = actions;

  useEffect(() => {
    const syncBindings = () => { bindingsRef.current = readDeviceShortcutBindings(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const combination = shortcutFromKeyboardEvent(event);
      if (!combination || !isSupportedShortcut(combination)) return;
      const entry = Object.entries(bindingsRef.current).find(([, assigned]) => assigned === combination);
      if (!entry) return;
      const action = actionRef.current.find((candidate) => candidate.id === entry[0]);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action.run();
    };

    syncBindings();
    window.addEventListener(CHANGE_EVENT, syncBindings);
    window.addEventListener('storage', syncBindings);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener(CHANGE_EVENT, syncBindings);
      window.removeEventListener('storage', syncBindings);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);
}
