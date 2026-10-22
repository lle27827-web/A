import type { ScreenReaderSwipeDirection } from './screen-reader-gestures';

export type ScreenReaderTouchNavigationOptions = {
  resolveTarget: (target: EventTarget | null) => HTMLElement | null;
  onSwipe: (direction: ScreenReaderSwipeDirection) => void;
  onSelect: (target: HTMLElement) => void;
  onActivate: (target: HTMLElement) => void;
  onMultiTouchStart: () => void;
};

type SingleTouch = {
  identifier: number;
  startX: number;
  startY: number;
  target: HTMLElement | null;
  swiped: boolean;
};

type MultiTouch = {
  target: HTMLElement | null;
  lastY: number;
  initialDistance: number;
  pinching: boolean;
};

type TapCandidate = {
  target: HTMLElement;
  time: number;
};

const SWIPE_DISTANCE_PX = 38;
const TAP_DISTANCE_PX = 18;
const DOUBLE_TAP_WINDOW_MS = 750;
const PINCH_DISTANCE_PX = 26;

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
      return;
    }

    if (event.touches.length === 2) {
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (!first || !second) return;
      options.onMultiTouchStart();
      singleTouch = null;
      multiTouch = {
        target: options.resolveTarget(target),
        lastY: (first.clientY + second.clientY) / 2,
        initialDistance: distanceBetween(first, second),
        pinching: false,
      };
      if (lastTap && Date.now() - lastTap.time > DOUBLE_TAP_WINDOW_MS) lastTap = null;
      return;
    }

    if (event.touches.length !== 1) {
      singleTouch = null;
      multiTouch = null;
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) return;
    const focusTarget = options.resolveTarget(target);
    const editingTarget = focusTarget?.matches('input, textarea, select, [contenteditable="true"]')
      && document.activeElement === focusTarget;
    if (editingTarget) {
      singleTouch = null;
      return;
    }

    singleTouch = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      target: focusTarget,
      swiped: false,
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
    if (singleTouch.swiped) return;

    const direction = screenReaderTouchSwipeDirection(
      touch.clientX - singleTouch.startX,
      touch.clientY - singleTouch.startY,
    );
    if (!direction) return;
    singleTouch.swiped = true;
    lastTap = null;
    options.onSwipe(direction);
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
    if (current.swiped || !current.target) return;

    const endTouch = Array.from(event.changedTouches)
      .find((touch) => touch.identifier === current.identifier);
    if (!endTouch) return;
    const moved = Math.hypot(endTouch.clientX - current.startX, endTouch.clientY - current.startY);
    if (moved > TAP_DISTANCE_PX) return;

    const now = Date.now();
    if (lastTap?.target === current.target && now - lastTap.time <= DOUBLE_TAP_WINDOW_MS) {
      lastTap = null;
      options.onActivate(current.target);
      return;
    }
    lastTap = { target: current.target, time: now };
    options.onSelect(current.target);
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
