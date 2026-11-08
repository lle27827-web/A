import { useEffect, useRef } from 'react';

export type KeyboardShortcutAction = {
  id: string;
  label: string;
  run: () => void;
  group?: string;
  targetId?: string;
  allowInDialog?: boolean;
  allowWhenEditing?: boolean;
};

export type KeyboardShortcutBinding = {
  id: string;
  actionId: string;
  combination: string;
};
export type KeyboardShortcutBindings = KeyboardShortcutBinding[];

const STORAGE_KEY = 'so-cong:keyboard-shortcuts:v2';
const LEGACY_STORAGE_KEY = 'so-cong:keyboard-shortcuts:v1';
const LABELS_STORAGE_KEY = 'so-cong:keyboard-shortcut-labels:v1';
const CHANGE_EVENT = 'so-cong:keyboard-shortcuts-change';
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];
const ACTION_ID_PATTERN = /^[a-z0-9-]{1,80}$/i;
const BINDING_ID_PATTERN = /^[a-z0-9-]{1,120}$/i;

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

function isLegacyBindings(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBindings(value: unknown): KeyboardShortcutBindings {
  const source: KeyboardShortcutBindings = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.actionId !== 'string' ||
        typeof record.combination !== 'string') continue;
      source.push({
        id: record.id,
        actionId: record.actionId,
        combination: record.combination,
      });
    }
  } else if (isLegacyBindings(value)) {
    for (const [actionId, combination] of Object.entries(value)) {
      if (typeof combination !== 'string') continue;
      source.push({
        id: `legacy-${shortcutActionHash(actionId)}`,
        actionId,
        combination,
      });
    }
  }

  const result: KeyboardShortcutBindings = [];
  const usedIds = new Set<string>();
  const usedCombinations = new Set<string>();
  for (const binding of source) {
    if (!BINDING_ID_PATTERN.test(binding.id) || !ACTION_ID_PATTERN.test(binding.actionId) ||
      usedIds.has(binding.id) || typeof binding.combination !== 'string') continue;
    const normalized = normalizeCombination(binding.combination);
    if (!normalized || !isSupportedShortcut(normalized) || usedCombinations.has(normalized)) continue;
    result.push({ ...binding, combination: normalized });
    usedIds.add(binding.id);
    usedCombinations.add(normalized);
  }
  return result;
}

export function createDeviceShortcutBindingId(): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `binding-${randomPart}`;
}

export function readDeviceShortcutBindings(): KeyboardShortcutBindings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return normalizeBindings(JSON.parse(stored));
    const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyStored) return [];
    return normalizeBindings(JSON.parse(legacyStored));
  } catch {
    return [];
  }
}

export function writeDeviceShortcutBindings(bindings: KeyboardShortcutBindings): boolean {
  try {
    const safe = normalizeBindings(bindings);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function readDeviceShortcutLabels(): Record<string, string> {
  try {
    const stored = window.localStorage.getItem(LABELS_STORAGE_KEY);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!isLegacyBindings(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, label]) =>
        /^[a-z0-9-]{1,80}$/i.test(id) && typeof label === 'string' && label.trim().length > 0,
      ).map(([id, label]) => [id, (label as string).trim().slice(0, 140)]),
    );
  } catch {
    return {};
  }
}

export function writeDeviceShortcutLabels(actions: KeyboardShortcutAction[], bindings: KeyboardShortcutBindings): void {
  try {
    const actionLabels = new Map(actions.map((action) => [action.id, action.label]));
    const existingLabels = readDeviceShortcutLabels();
    const labels: Record<string, string> = {};
    for (const { actionId } of bindings) {
      const label = actionLabels.get(actionId) ?? existingLabels[actionId];
      if (label) labels[actionId] = label;
    }
    window.localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Shortcut assignment still works if device label storage is unavailable.
  }
}

function shortcutActionHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shortcutLabel(element: HTMLElement): string {
  const explicit = element.getAttribute('aria-label')?.trim() || element.getAttribute('title')?.trim();
  if (explicit) return explicit.replace(/\s+/g, ' ').slice(0, 140);
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 140);
  const testId = element.dataset.testid;
  return testId
    ? testId.replace(/^(button|link|select|input)-/i, '').replace(/[-_]+/g, ' ').slice(0, 140)
    : '';
}

function shortcutTarget(id: string): HTMLElement | null {
  const target = document.querySelector<HTMLElement>(`[data-keyboard-shortcut-target-id="${id}"]`);
  if (!target || target.hidden || target.getAttribute('aria-disabled') === 'true' ||
    target.closest('[inert], [aria-hidden="true"]')) return null;
  if (target instanceof HTMLButtonElement && target.disabled) return null;
  if (!target.getClientRects().length || getComputedStyle(target).visibility === 'hidden') return null;
  return target;
}

/** Discovers currently rendered controls so each visible action can be assigned on its screen. */
export function discoverDeviceShortcutActions(): KeyboardShortcutAction[] {
  if (typeof document === 'undefined') return [];
  const pageTitle = document.querySelector<HTMLElement>('#main h1')?.innerText?.trim();
  const group = pageTitle ? `Nút trên màn hình · ${pageTitle}` : 'Nút trên màn hình';
  const duplicates = new Map<string, number>();
  const actions: KeyboardShortcutAction[] = [];
  const controls = document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]');

  for (const element of controls) {
    if (element.closest('.keyboard-shortcuts-settings, [data-keyboard-shortcut-exclude], .skip-link')) continue;
    const containingDialog = element.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (containingDialog && containingDialog.dataset.testid !== 'dialog-view-settings') continue;
    // Radix marks the page behind Settings as aria-hidden while its modal is open.
    // Keep those page controls discoverable, but never include controls hidden by layout.
    if (element.closest('[inert]') || element.hidden || element.getAttribute('aria-hidden') === 'true') continue;
    if (element instanceof HTMLButtonElement && element.disabled) continue;
    if (element.getAttribute('aria-disabled') === 'true' || !element.getClientRects().length ||
      getComputedStyle(element).visibility === 'hidden') continue;

    const label = shortcutLabel(element);
    if (!label) continue;
    const identity = element.dataset.testid || element.id ||
      `${element.tagName}:${element.getAttribute('aria-label') ?? ''}:${label}:${element.getAttribute('href') ?? ''}`;
    const occurrence = duplicates.get(identity) ?? 0;
    duplicates.set(identity, occurrence + 1);
    const id = `ui-${shortcutActionHash(`${window.location.pathname}:${identity}:${occurrence}`)}`;
    if (element.dataset.keyboardShortcutTargetId !== id) {
      element.dataset.keyboardShortcutTargetId = id;
    }
    actions.push({
      id,
      label,
      group,
      targetId: id,
      run: () => shortcutTarget(id)?.click(),
    });
  }

  return actions;
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
    const syncTargets = () => { discoverDeviceShortcutActions(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const combination = shortcutFromKeyboardEvent(event);
      if (!combination || !isSupportedShortcut(combination)) return;
      const binding = bindingsRef.current.find((assigned) => assigned.combination === combination);
      if (!binding) return;
      const action = actionRef.current.find((candidate) => candidate.id === binding.actionId) ??
        (binding.actionId.startsWith('ui-') ? {
          id: binding.actionId,
          label: readDeviceShortcutLabels()[binding.actionId] ?? 'Nút trên màn hình',
          targetId: binding.actionId,
          run: () => shortcutTarget(binding.actionId)?.click(),
        } : undefined);
      if (!action) return;
      if (document.activeElement?.closest('[data-keyboard-shortcut-capture], .keyboard-shortcuts-settings')) return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const activeDialog = dialogs.item(dialogs.length - 1) ?? null;
      const target = action.targetId ? shortcutTarget(action.targetId) : null;
      if (action.targetId && !target) return;
      if (activeDialog && !(action.allowInDialog || (target && activeDialog.contains(target)))) return;
      if (isEditableTarget(event.target) && !action.allowWhenEditing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (target) target.click();
      else action.run();
    };

    syncBindings();
    syncTargets();
    window.addEventListener(CHANGE_EVENT, syncBindings);
    window.addEventListener('storage', syncBindings);
    window.addEventListener('keydown', onKeyDown, true);
    const observer = typeof MutationObserver === 'undefined' || !document.body
      ? null
      : new MutationObserver(syncTargets);
    observer?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-hidden', 'disabled', 'hidden', 'title', 'data-testid'],
    });
    return () => {
      window.removeEventListener(CHANGE_EVENT, syncBindings);
      window.removeEventListener('storage', syncBindings);
      window.removeEventListener('keydown', onKeyDown, true);
      observer?.disconnect();
    };
  }, []);
}

export function submitActiveDialogForm(): void {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const activeDialog = dialogs.item(dialogs.length - 1);
  if (!activeDialog || activeDialog.querySelector('.keyboard-shortcuts-settings')) return;
  const form = activeDialog.querySelector<HTMLFormElement>('form[data-keyboard-shortcut-save="true"]');
  if (!form || form.hidden || !form.getClientRects().length) return;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit?.disabled) return;
  if (submit) submit.click();
  else form.requestSubmit();
}
