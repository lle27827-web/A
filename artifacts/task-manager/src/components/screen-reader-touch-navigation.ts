import type { ScreenReaderSwipeDirection } from './screen-reader-gestures';

export type ScreenReaderTouchPoint = { x: number; y: number };

export type ScreenReaderTouchNavigationOptions = {
  resolveTarget: (target: EventTarget | null, point?: ScreenReaderTouchPoint) => HTMLElement | null;
  onSwipe: (direction: ScreenReaderSwipeDirection) => void;
  onShortcutGesture: (directions: readonly [ScreenReaderSwipeDirection, ScreenReaderSwipeDirection]) => void;
  onTap: (target: HTMLElement | null) => void;
  onExplore: (target: HTMLElement) => void;
  onActivate: () => void;
};

type SingleTouch = {
  identifier: number;
  startX: number;
  startY: number;
  startedAt: number;
  target: HTMLElement | null;
  moved: boolean;
  exploredDuringDrag: boolean;
  quickDirectionalSwipe: boolean;
  doubleTapCandidate: boolean;
  points: ScreenReaderTouchPoint[];
};

type MultiTouch = {
  target: HTMLElement | null;
  lastY: number;
  initialDistance: number;
  pinching: boolean;
};

type TapCandidate = { time: number };

const SWIPE_DISTANCE_PX = 38;
const TAP_DISTANCE_PX = 18;
const DOUBLE_TAP_WINDOW_MS = 750;
const PINCH_DISTANCE_PX = 26;
const PATH_SAMPLE_DISTANCE_PX = 7;

export function isScreenReaderDoubleTap(
  previousTapTime: number | null,
  currentTapTime: number,
): boolean {
  return previousTapTime !== null
    && currentTapTime - previousTapTime <= DOUBLE_TAP_WINDOW_MS;
}

export function screenReaderTapDecision(
  previousTapTime: number | null,
  currentTapTime: number,
): 'focus-touched-target' | 'activate-current-focus' {
  return isScreenReaderDoubleTap(previousTapTime, currentTapTime)
    ? 'activate-current-focus'
    : 'focus-touched-target';
}

function distanceBetween(first: Touch, second: Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function scrollableAncestor(target: HTMLElement | null): HTMLElement | null {
  let current = target;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      /(auto|scroll)/u.test(style.overflowY)
      && current.scrollHeight > current.clientHeight + 1
    ) return current;
    current = current.parentElement;
  }

  const main = document.querySelector<HTMLElement>('#main, .p-main, main');
  if (main && main.scrollHeight > main.clientHeight + 1) return main;
  return null;
}

export function screenReaderTouchSwipeDirection(
  deltaX: number,
  deltaY: number,
): ScreenReaderSwipeDirection | null {
  const isHorizontal = Math.abs(deltaX) >= SWIPE_DISTANCE_PX
    && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
  const isVertical = Math.abs(deltaY) >= SWIPE_DISTANCE_PX
    && Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
  if (isHorizontal) return deltaX < 0 ? 'left' : 'right';
  if (isVertical) return deltaY < 0 ? 'up' : 'down';
  return null;
}

export function screenReaderTouchShortcutGesture(
  points: readonly ScreenReaderTouchPoint[],
): readonly [ScreenReaderSwipeDirection, ScreenReaderSwipeDirection] | null {
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  if (maxX - minX < 36) return null;

  const apexCandidates = [
    { index: points.reduce((best, point, index) => point.y < points[best].y ? index : best, 0), directions: ['up', 'down'] as const },
    { index: points.reduce((best, point, index) => point.y > points[best].y ? index : best, 0), directions: ['down', 'up'] as const },
  ];

  for (const { index, directions } of apexCandidates) {
    if (index === 0 || index === points.length - 1) continue;
    const apex = points[index];
    const firstVertical = apex.y - first.y;
    const secondVertical = last.y - apex.y;
    const firstX = apex.x - first.x;
    const secondX = last.x - apex.x;
    const verticalMatches = directions[0] === 'up'
      ? firstVertical <= -SWIPE_DISTANCE_PX && secondVertical >= SWIPE_DISTANCE_PX
      : firstVertical >= SWIPE_DISTANCE_PX && secondVertical <= -SWIPE_DISTANCE_PX;
    const horizontalMatches = Math.abs(firstX) >= 8
      && Math.abs(secondX) >= 8
      && Math.sign(firstX) === Math.sign(secondX);
    const branchRatio = Math.abs(firstVertical) / Math.max(1, Math.abs(secondVertical));
    if (
      verticalMatches
      && horizontalMatches
      && branchRatio >= 0.35
      && branchRatio <= 2.85
    ) return directions;
  }
  return null;
}

export function attachScreenReaderTouchNavigation(
  options: ScreenReaderTouchNavigationOptions,
): () => void {
  let singleTouch: SingleTouch | null = null;
  let multiTouch: MultiTouch | null = null;
  let lastTap: TapCandidate | null = null;

  function onTouchStart(event: TouchEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('.screen-reader-assistant')) {
      singleTouch = null;
      multiTouch = null;
      lastTap = null;
      return;
    }

    if (event.touches.length === 2) {
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      singleTouch = null;
      lastTap = null;
      const center = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
      multiTouch = {
        target: options.resolveTarget(target, center),
        lastY: (first.clientY + second.clientY) / 2,
        initialDistance: distanceBetween(first, second),
        pinching: false,
      };
      return;
    }

    if (event.touches.length !== 1) {
      singleTouch = null;
      multiTouch = null;
      lastTap = null;
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) return;
    const focusTarget = options.resolveTarget(target, { x: touch.clientX, y: touch.clientY });
    const editingTarget = focusTarget?.matches('input, textarea, select, [contenteditable="true"]')
      && document.activeElement === focusTarget;
    if (editingTarget) {
      singleTouch = null;
      lastTap = null;
      return;
    }

    singleTouch = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startedAt: Date.now(),
      target: focusTarget,
      moved: false,
      exploredDuringDrag: false,
      quickDirectionalSwipe: false,
      doubleTapCandidate: screenReaderTapDecision(lastTap?.time ?? null, Date.now()) === 'activate-current-focus',
      points: [{ x: touch.clientX, y: touch.clientY }],
    };
    multiTouch = null;
    if (event.cancelable) event.preventDefault();
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length === 2 && multiTouch) {
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      const distance = distanceBetween(first, second);
      if (Math.abs(distance - multiTouch.initialDistance) > PINCH_DISTANCE_PX) {
        multiTouch.pinching = true;
        return;
      }
      if (multiTouch.pinching) return;

      const centerY = (first.clientY + second.clientY) / 2;
      const deltaY = centerY - multiTouch.lastY;
      multiTouch.lastY = centerY;
      if (event.cancelable) event.preventDefault();
      if (deltaY === 0) return;

      const container = scrollableAncestor(multiTouch.target);
      if (container) container.scrollTop -= deltaY;
      else window.scrollBy({ top: -deltaY, behavior: 'auto' });
      return;
    }

    const touch = event.touches.length === 1 ? event.touches.item(0) : null;
    if (!touch || !singleTouch || touch.identifier !== singleTouch.identifier) return;
    if (event.cancelable) event.preventDefault();
    const point = { x: touch.clientX, y: touch.clientY };
    const deltaX = point.x - singleTouch.startX;
    const deltaY = point.y - singleTouch.startY;
    const distanceFromStart = Math.hypot(deltaX, deltaY);
    if (distanceFromStart > TAP_DISTANCE_PX) {
      singleTouch.moved = true;
      if (singleTouch.doubleTapCandidate) singleTouch.doubleTapCandidate = false;
      lastTap = null;
    }
    const horizontalMotion = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    const verticalMotion = Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
    if (
      distanceFromStart >= 32
      && (horizontalMotion || verticalMotion)
      && Date.now() - singleTouch.startedAt <= 260
    ) {
      singleTouch.quickDirectionalSwipe = true;
    }
    const previousPoint = singleTouch.points[singleTouch.points.length - 1];
    if (Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) >= PATH_SAMPLE_DISTANCE_PX) {
      singleTouch.points.push(point);
    }

    if (!singleTouch.doubleTapCandidate && singleTouch.moved && !singleTouch.quickDirectionalSwipe) {
      const target = options.resolveTarget(event.target, point);
      if (target && target !== singleTouch.target) {
        singleTouch.target = target;
        singleTouch.exploredDuringDrag = true;
        options.onExplore(target);
      }
    }
  }

  function onTouchEnd(event: TouchEvent) {
    if (multiTouch) {
      if (event.touches.length < 2) multiTouch = null;
      return;
    }

    const current = singleTouch;
    if (!current) return;
    const ended = Array.from(event.changedTouches)
      .some((touch) => touch.identifier === current.identifier);
    if (!ended) return;
    singleTouch = null;
    if (event.cancelable) event.preventDefault();
    const endTouch = Array.from(event.changedTouches)
      .find((touch) => touch.identifier === current.identifier);
    if (!endTouch) return;
    const moved = Math.hypot(endTouch.clientX - current.startX, endTouch.clientY - current.startY);
    if (current.doubleTapCandidate && moved <= TAP_DISTANCE_PX) {
      lastTap = null;
      options.onActivate();
      return;
    }

    if (moved > TAP_DISTANCE_PX) {
      lastTap = null;
      const finalPoint = { x: endTouch.clientX, y: endTouch.clientY };
      const previousPoint = current.points[current.points.length - 1];
      if (Math.hypot(finalPoint.x - previousPoint.x, finalPoint.y - previousPoint.y) > 1) {
        current.points.push(finalPoint);
      }
      const shortcut = screenReaderTouchShortcutGesture(current.points);
      if (shortcut) {
        options.onShortcutGesture(shortcut);
        return;
      }
      const direction = screenReaderTouchSwipeDirection(
        endTouch.clientX - current.startX,
        endTouch.clientY - current.startY,
      );
      if (direction && (!current.exploredDuringDrag || current.quickDirectionalSwipe)) options.onSwipe(direction);
      else if (!current.exploredDuringDrag && current.target) options.onExplore(current.target);
      return;
    }

    const now = Date.now();
    lastTap = { time: now };
    options.onTap(current.target);
  }

  function onTouchCancel() {
    singleTouch = null;
    multiTouch = null;
    lastTap = null;
  }

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: false });

  return () => {
    singleTouch = null;
    multiTouch = null;
    lastTap = null;
    document.removeEventListener('touchstart', onTouchStart, true);
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchCancel, true);
  };
}
