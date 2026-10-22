export type AppTouchPoint = { x: number; y: number };
export type AppTouchGesture = 'save' | 'back';

const MIN_SEGMENT_PX = 44;
const DIRECTION_DOMINANCE = 1.2;
const POINT_SAMPLE_PX = 7;
const MAX_PATH_POINTS = 220;
const CLICK_SUPPRESSION_MS = 500;

export function isSafeAppSaveLabel(label: string): boolean {
  return /^(lưu|ghi nhận|tạo|cập nhật|hoàn tất)(?:\b|\s)/u.test(label.trim().toLocaleLowerCase('vi-VN'));
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
  points: AppTouchPoint[];
};

type SuppressedClick = AppTouchPoint & { expiresAt: number };

export function attachAppTouchGestures(options: {
  onGesture: (gesture: AppTouchGesture) => void;
}): () => void {
  let trackedTouch: TrackedTouch | null = null;
  let suppressedClick: SuppressedClick | null = null;
  let clearSuppressedClickTimer: number | null = null;

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      trackedTouch = null;
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(
      'input, textarea, select, [contenteditable="true"], [data-app-gesture-ignore]',
    )) {
      trackedTouch = null;
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) return;
    trackedTouch = {
      identifier: touch.identifier,
      points: [{ x: touch.clientX, y: touch.clientY }],
    };
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches.length === 1 ? event.touches.item(0) : null;
    if (!touch || !trackedTouch || touch.identifier !== trackedTouch.identifier) {
      trackedTouch = null;
      return;
    }
    const point = { x: touch.clientX, y: touch.clientY };
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

    const finalPoint = { x: ended.clientX, y: ended.clientY };
    const lastPoint = current.points[current.points.length - 1];
    if (Math.hypot(finalPoint.x - lastPoint.x, finalPoint.y - lastPoint.y) > 1) {
      current.points.push(finalPoint);
    }
    const gesture = appTouchGestureForPath(current.points);
    if (!gesture) return;

    if (event.cancelable) event.preventDefault();
    suppressedClick = { ...finalPoint, expiresAt: Date.now() + CLICK_SUPPRESSION_MS };
    if (clearSuppressedClickTimer !== null) window.clearTimeout(clearSuppressedClickTimer);
    clearSuppressedClickTimer = window.setTimeout(() => {
      suppressedClick = null;
      clearSuppressedClickTimer = null;
    }, CLICK_SUPPRESSION_MS);

    // Let the browser finish the touch's click sequence before a back action
    // clicks a dialog close control or a save action submits its form.
    window.setTimeout(() => options.onGesture(gesture), 0);
  }

  function onTouchCancel() {
    trackedTouch = null;
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

  return () => {
    trackedTouch = null;
    suppressedClick = null;
    if (clearSuppressedClickTimer !== null) window.clearTimeout(clearSuppressedClickTimer);
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchCancel, true);
    document.removeEventListener('click', onClick, true);
  };
}
