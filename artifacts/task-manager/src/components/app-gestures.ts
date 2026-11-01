export type AppTouchPoint = { x: number; y: number };
export type AppTouchGesture = 'save' | 'back';

const MIN_SEGMENT_PX = 44;
const DIRECTION_DOMINANCE = 1.2;
const POINT_SAMPLE_PX = 7;
const MAX_PATH_POINTS = 220;
const CLICK_SUPPRESSION_MS = 500;
const LONG_PRESS_SAVE_MS = 2_000;
const LONG_PRESS_MOVE_CANCEL_PX = 24;

export function isSafeAppSaveLabel(label: string): boolean {
  return /^(lưu|ghi nhận|tạo|cập nhật|hoàn tất)(?:\b|\s)/u.test(label.trim().toLocaleLowerCase('vi-VN'));
}

export function isSafeLongPressSaveTarget(scope: string | null, label: string): boolean {
  return scope === 'attendance' && isSafeAppSaveLabel(label);
}

function appBackFallback(location: string): string | null {
  const queryIndex = location.indexOf('?');
  const pathname = (queryIndex >= 0 ? location.slice(0, queryIndex) : location).replace(/\/+$/u, '') || '/';
  const search = queryIndex >= 0 ? location.slice(queryIndex) : '';
  if (/^\/employees\/[^/]+$/u.test(pathname)) return `/employees${search}`;
  if (/^\/cards\/[^/]+$/u.test(pathname)) return `/cards${search}`;
  if (pathname === '/' || pathname === '/attendance' || pathname === '/personal') return null;
  if (pathname.startsWith('/personal/')) return '/personal';
  return '/';
}

export function previousAppLocation(
  history: readonly string[],
  currentLocation: string,
): { target: string | null; history: string[] } {
  const currentIndex = history.lastIndexOf(currentLocation);
  const nextHistory = currentIndex >= 0
    ? history.slice(0, currentIndex + 1)
    : [...history, currentLocation];
  if (nextHistory.length > 1) {
    nextHistory.pop();
    return { target: nextHistory[nextHistory.length - 1], history: nextHistory };
  }
  const fallback = appBackFallback(currentLocation);
  if (fallback) return { target: fallback, history: [fallback] };
  return { target: null, history: [currentLocation] };
}

function isUp(from: AppTouchPoint, to: AppTouchPoint): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dy <= -MIN_SEGMENT_PX && Math.abs(dy) > Math.abs(dx) * DIRECTION_DOMINANCE;
}

function isRight(from: AppTouchPoint, to: AppTouchPoint): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx >= MIN_SEGMENT_PX && Math.abs(dx) > Math.abs(dy) * DIRECTION_DOMINANCE;
}

function isLeft(from: AppTouchPoint, to: AppTouchPoint): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx <= -MIN_SEGMENT_PX && Math.abs(dx) > Math.abs(dy) * DIRECTION_DOMINANCE;
}

export function appTouchGestureForPath(points: readonly AppTouchPoint[]): AppTouchGesture | null {
  if (points.length < 3) return null;
  const start = points[0];
  const end = points[points.length - 1];

  let leftmostIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].x < points[leftmostIndex].x) leftmostIndex = index;
  }
  const leftmost = points[leftmostIndex];
  if (
    leftmostIndex > 0
    && leftmostIndex < points.length - 1
    && isLeft(start, leftmost)
    && isRight(leftmost, end)
  ) return 'back';

  for (let upIndex = 1; upIndex < points.length - 2; upIndex += 1) {
    const upPivot = points[upIndex];
    if (!isUp(start, upPivot)) continue;

    let rightmostIndex = upIndex + 1;
    for (let index = upIndex + 2; index < points.length - 1; index += 1) {
      if (points[index].x > points[rightmostIndex].x) rightmostIndex = index;
    }
    const rightPivot = points[rightmostIndex];
    if (
      rightmostIndex > upIndex
      && rightmostIndex < points.length - 1
      && isRight(upPivot, rightPivot)
      && isLeft(rightPivot, end)
    ) return 'save';
  }

  return null;
}

type TrackedTouch = {
  identifier: number;
  origin: AppTouchPoint;
  points: AppTouchPoint[];
  longPressTimer: number | null;
  longPressTriggered: boolean;
  swipeAllowed: boolean;
};

type SuppressedClick = AppTouchPoint & { expiresAt: number };

export function attachAppTouchGestures(options: {
  onGesture: (gesture: AppTouchGesture) => void;
  onLongPressSave?: () => boolean;
}): () => void {
  let trackedTouch: TrackedTouch | null = null;
  let suppressedClick: SuppressedClick | null = null;
  let clearSuppressedClickTimer: number | null = null;

  function clearLongPressTimer(touch: TrackedTouch | null) {
    if (touch?.longPressTimer !== null && touch?.longPressTimer !== undefined) {
      window.clearTimeout(touch.longPressTimer);
      touch.longPressTimer = null;
    }
  }

  function suppressClickAt(point: AppTouchPoint) {
    suppressedClick = { ...point, expiresAt: Date.now() + CLICK_SUPPRESSION_MS };
    if (clearSuppressedClickTimer !== null) window.clearTimeout(clearSuppressedClickTimer);
    clearSuppressedClickTimer = window.setTimeout(() => {
      suppressedClick = null;
      clearSuppressedClickTimer = null;
    }, CLICK_SUPPRESSION_MS);
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      clearLongPressTimer(trackedTouch);
      trackedTouch = null;
      return;
    }
    const target = event.target;
    const touch = event.touches.item(0);
    if (!touch) return;
    const origin = { x: touch.clientX, y: touch.clientY };
    trackedTouch = {
      identifier: touch.identifier,
      origin,
      points: [origin],
      longPressTimer: null,
      longPressTriggered: false,
      swipeAllowed: !(target instanceof Element && target.closest(
        'input, textarea, select, [contenteditable="true"], [data-app-gesture-ignore]',
      )),
    };
    const tracked = trackedTouch;
    tracked.longPressTimer = window.setTimeout(() => {
      if (trackedTouch !== tracked) return;
      tracked.longPressTimer = null;
      if (options.onLongPressSave) {
        tracked.longPressTriggered = options.onLongPressSave();
      } else {
        options.onGesture('save');
        tracked.longPressTriggered = true;
      }
    }, LONG_PRESS_SAVE_MS);
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches.length === 1 ? event.touches.item(0) : null;
    if (!touch || !trackedTouch || touch.identifier !== trackedTouch.identifier) {
      clearLongPressTimer(trackedTouch);
      trackedTouch = null;
      return;
    }
    const point = { x: touch.clientX, y: touch.clientY };
    if (Math.hypot(point.x - trackedTouch.origin.x, point.y - trackedTouch.origin.y) > LONG_PRESS_MOVE_CANCEL_PX) {
      clearLongPressTimer(trackedTouch);
    }
    const previous = trackedTouch.points[trackedTouch.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= POINT_SAMPLE_PX) {
      if (trackedTouch.points.length < MAX_PATH_POINTS) trackedTouch.points.push(point);
      else trackedTouch.points[trackedTouch.points.length - 1] = point;
    }
  }

  function onTouchEnd(event: TouchEvent) {
    const current = trackedTouch;
    if (!current) return;
    const ended = Array.from(event.changedTouches)
      .find((touch) => touch.identifier === current.identifier);
    if (!ended) return;
    trackedTouch = null;
    clearLongPressTimer(current);

    const finalPoint = { x: ended.clientX, y: ended.clientY };
    if (current.longPressTriggered) {
      if (event.cancelable) event.preventDefault();
      suppressClickAt(finalPoint);
      return;
    }

    if (!current.swipeAllowed) return;

    const lastPoint = current.points[current.points.length - 1];
    if (Math.hypot(finalPoint.x - lastPoint.x, finalPoint.y - lastPoint.y) > 1) {
      current.points.push(finalPoint);
    }
    const gesture = appTouchGestureForPath(current.points);
    if (!gesture) return;

    if (event.cancelable) event.preventDefault();
    suppressClickAt(finalPoint);

    // Let the browser finish the touch's click sequence before a back action
    // clicks a dialog close control or a save action submits its form.
    window.setTimeout(() => options.onGesture(gesture), 0);
  }

  function onTouchCancel() {
    clearLongPressTimer(trackedTouch);
    trackedTouch = null;
  }

  function onContextMenu(event: Event) {
    if (trackedTouch?.longPressTriggered || (trackedTouch?.longPressTimer !== null && trackedTouch?.longPressTimer !== undefined)) {
      event.preventDefault();
    }
  }

  function onClick(event: MouseEvent) {
    if (!suppressedClick || event.detail === 0) return;
    if (Date.now() > suppressedClick.expiresAt) {
      suppressedClick = null;
      return;
    }
    if (Math.hypot(event.clientX - suppressedClick.x, event.clientY - suppressedClick.y) > 48) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    suppressedClick = null;
    if (clearSuppressedClickTimer !== null) {
      window.clearTimeout(clearSuppressedClickTimer);
      clearSuppressedClickTimer = null;
    }
  }

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);

  return () => {
    clearLongPressTimer(trackedTouch);
    trackedTouch = null;
    suppressedClick = null;
    if (clearSuppressedClickTimer !== null) window.clearTimeout(clearSuppressedClickTimer);
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchCancel, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
  };
}
