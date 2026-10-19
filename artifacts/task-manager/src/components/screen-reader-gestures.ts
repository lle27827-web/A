export type ScreenReaderSwipeDirection = 'up' | 'down';

export type ScreenReaderAction = 'employees' | 'cards' | 'home' | 'save';

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
