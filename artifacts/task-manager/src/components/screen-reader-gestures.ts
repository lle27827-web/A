export type ScreenReaderSwipeDirection = 'up' | 'down' | 'left' | 'right';

export type ScreenReaderAction = 'employees' | 'cards' | 'home' | 'save';
export type ScreenReaderFocusNavigation = 'previous' | 'next';
export type ScreenReaderKeyboardAction =
  | ScreenReaderAction
  | 'previous-heading'
  | 'next-heading'
  | 'previous-item'
  | 'next-item';

export const MIN_SCREEN_READER_RATE = 0.6;
export const MAX_SCREEN_READER_RATE = 1.8;
export const MIN_SCREEN_READER_VOLUME = 0.1;
export const MAX_SCREEN_READER_VOLUME = 1;

export function normalizeSpeechRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  const clamped = Math.min(MAX_SCREEN_READER_RATE, Math.max(MIN_SCREEN_READER_RATE, value));
  return Math.round(clamped * 10) / 10;
}

export function normalizeSpeechVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.8;
  const clamped = Math.min(MAX_SCREEN_READER_VOLUME, Math.max(MIN_SCREEN_READER_VOLUME, value));
  return Math.round(clamped * 10) / 10;
}

export function screenReaderFocusNavigationForSwipe(
  direction: ScreenReaderSwipeDirection,
): ScreenReaderFocusNavigation | null {
  if (direction === 'left') return 'previous';
  if (direction === 'right') return 'next';
  return null;
}

export function screenReaderKeyboardActionForKey(input: {
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): ScreenReaderKeyboardAction | null {
  if (!input.altKey || !input.shiftKey || input.ctrlKey || input.metaKey) return null;
  switch (input.code) {
    case 'ArrowLeft': return 'previous-heading';
    case 'ArrowRight': return 'next-heading';
    case 'ArrowUp': return 'previous-item';
    case 'ArrowDown': return 'next-item';
    case 'KeyH': return 'home';
    case 'KeyS': return 'save';
    case 'KeyE': return 'employees';
    case 'KeyC': return 'cards';
    default: return null;
  }
}

export function nextScreenReaderFocusIndex(
  currentIndex: number,
  targetCount: number,
  direction: ScreenReaderFocusNavigation,
): number | null {
  if (!Number.isInteger(targetCount) || targetCount <= 0) return null;
  const startIndex = currentIndex >= 0 && currentIndex < targetCount
    ? currentIndex
    : direction === 'next' ? -1 : targetCount;
  const nextIndex = startIndex + (direction === 'next' ? 1 : -1);
  return nextIndex >= 0 && nextIndex < targetCount ? nextIndex : null;
}

export function isSafeSaveLabel(label: string): boolean {
  return /^(lưu|ghi nhận|tạo|cập nhật|hoàn tất)(?:\b|\s)/u.test(label.trim().toLocaleLowerCase('vi-VN'));
}

export function screenReaderActionForSwipes(
  directions: readonly ScreenReaderSwipeDirection[],
): ScreenReaderAction | null {
  if (directions.length === 1) {
    return directions[0] === 'up' ? 'home' : directions[0] === 'down' ? 'save' : null;
  }

  if (directions.length === 2) {
    if (directions[0] === 'up' && directions[1] === 'down') return 'employees';
    if (directions[0] === 'down' && directions[1] === 'up') return 'cards';
  }

  return null;
}
