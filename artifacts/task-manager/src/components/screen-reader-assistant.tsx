import { useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, CreditCard, Home, Pause, Play, Save, SkipBack, SkipForward, Volume2, Users, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { ScreenReaderContext } from '@/components/screen-reader-context';
import {
  isSafeSaveLabel,
  nextScreenReaderFocusIndex,
  screenReaderActionForSwipes,
  screenReaderFocusNavigationForSwipe,
  screenReaderKeyboardActionForKey,
  type ScreenReaderAction,
  type ScreenReaderFocusNavigation,
  type ScreenReaderSwipeDirection,
} from './screen-reader-gestures';
import { attachScreenReaderTouchNavigation } from './screen-reader-touch-navigation';

const COMBO_WINDOW_MS = 650;
const SWIPE_DISTANCE_PX = 36;
const PAGE_FOCUS_SELECTOR = [
  'h1, h2, h3, h4, h5, h6, [role="heading"]',
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[role="button"][tabindex]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function visible(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && window.getComputedStyle(element).visibility !== 'hidden'
    && window.getComputedStyle(element).display !== 'none';
}

function pageHeading(): string {
  const main = document.querySelector<HTMLElement>('#main, .p-main, main');
  const heading = main?.querySelector<HTMLElement>('h1, h2, [role="heading"]');
  return heading?.innerText.trim() || document.title || 'SỔ CÔNG';
}

function focusNavigationRoot(): HTMLElement | null {
  const active = document.activeElement;
  const activeDialog = active instanceof HTMLElement
    ? active.closest<HTMLElement>('[role="dialog"][aria-modal="true"]')
    : null;
  if (activeDialog && visible(activeDialog)) return activeDialog;

  const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(visible);
  return openDialogs.at(-1) ?? document.body;
}

function visiblePageFocusTargets(): HTMLElement[] {
  const root = focusNavigationRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(PAGE_FOCUS_SELECTOR))
    .filter((target) => visible(target))
    .filter((target) => !target.matches('[aria-disabled="true"], :disabled'))
    .filter((target) => !target.closest('.screen-reader-assistant'))
    .filter((target) => Boolean(elementLabel(target)));
}

function touchFocusTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element) || target.closest('.screen-reader-assistant')) return null;
  const root = focusNavigationRoot();
  const label = target.closest('label');
  const control = label instanceof HTMLLabelElement ? label.control : null;
  const candidate = control instanceof HTMLElement
    ? control
    : target.closest<HTMLElement>(PAGE_FOCUS_SELECTOR);
  if (!candidate || !root?.contains(candidate) || !visible(candidate)) return null;
  if (candidate.matches('[aria-disabled="true"], :disabled')) return null;
  return candidate;
}

function pageFocusTargetIndex(targets: HTMLElement[], target: HTMLElement | null): number {
  if (!target) return -1;
  const exactIndex = targets.indexOf(target);
  return exactIndex >= 0
    ? exactIndex
    : targets.findIndex((candidate) => candidate.contains(target));
}

function visiblePageHeadings(): HTMLElement[] {
  const root = focusNavigationRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'))
    .filter((target) => visible(target))
    .filter((target) => !target.closest('.screen-reader-assistant'))
    .filter((target) => Boolean(elementLabel(target)));
}

function conciseText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.hint, .sub, [aria-hidden="true"]').forEach((child) => child.remove());
  return (copy.innerText || copy.textContent || '').replace(/\s+/g, ' ').trim();
}

function elementLabel(active: HTMLElement): string {
  const explicit = active.getAttribute('aria-label');
  if (explicit) return explicit.trim();

  const labelledBy = active.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map((id) => {
        const label = document.getElementById(id);
        return label instanceof HTMLElement ? conciseText(label) : '';
      })
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    if (active instanceof HTMLInputElement && active.type === 'password') {
      return active.labels?.[0]?.innerText.trim() || 'Ô nhập mật khẩu';
    }
    const labelNode = active.labels?.[0];
    const label = labelNode ? conciseText(labelNode)
      || active.getAttribute('placeholder')
      || active.getAttribute('title')
      || 'Ô nhập liệu' : active.getAttribute('placeholder') || active.getAttribute('title') || 'Ô nhập liệu';
    if (active instanceof HTMLSelectElement) {
      const choice = active.selectedOptions[0]?.textContent?.trim();
      return choice ? `${label}: ${choice}` : label;
    }
    return active.value ? `${label}: ${active.value}` : label;
  }

  const text = conciseText(active);
  return text.slice(0, 100) || '';
}

function useScreenReaderAssistant() {
  const value = useContext(ScreenReaderContext);
  if (!value) throw new Error('Screen reader assistant rendered outside its provider');
  return value;
}

function safeSaveTarget(): { form: HTMLFormElement; button: HTMLButtonElement } | null {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form')).filter(visible);
  const lastForm = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest('form')
    : null;
  const orderedForms = lastForm && forms.includes(lastForm as HTMLFormElement)
    ? [lastForm as HTMLFormElement, ...forms.filter((form) => form !== lastForm)]
    : forms.reverse();

  for (const form of orderedForms) {
    if (form.getAttribute('role') === 'search') continue;
    const button = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
      .find((candidate) => {
        if (candidate.disabled || !visible(candidate)) return false;
        const label = candidate.innerText || candidate.getAttribute('aria-label') || '';
        return isSafeSaveLabel(label);
      });
    if (button) return { form, button };
  }
  return null;
}

export function ScreenReaderAssistant() {
  const {
    enabled,
    speechRate,
    speechVolume,
    voiceURI,
    autoReadFocus,
    touchNavigationEnabled,
    focusSwipesEnabled,
    shortcutSwipesEnabled,
  } = useScreenReaderAssistant();
  const [location, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const lastFocusedPageElement = useRef<HTMLElement | null>(null);
  const activeUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingDirection = useRef<ScreenReaderSwipeDirection | null>(null);
  const pendingTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const previousLocation = useRef(location);
  const currentFocusIndex = useRef(-1);
  const currentHeadingIndex = useRef(-1);
  const touchFocusedElement = useRef<HTMLElement | null>(null);
  const [speechActive, setSpeechActive] = useState(false);
  const [speechPaused, setSpeechPaused] = useState(false);
  function speak(text: string) {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) return;
    setAnnouncement(cleanText);
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setAnnouncement('Trình duyệt không hỗ trợ đọc bằng giọng nói.');
      return;
    }
    activeUtterance.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'vi-VN';
    utterance.rate = speechRate;
    utterance.volume = speechVolume;
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI);
    const vietnameseVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('vi'));
    const voice = selectedVoice ?? vietnameseVoice;
    if (voice) utterance.voice = voice;
    activeUtterance.current = utterance;
    setSpeechActive(true);
    setSpeechPaused(false);
    const finish = () => {
      if (activeUtterance.current !== utterance) return;
      activeUtterance.current = null;
      setSpeechActive(false);
      setSpeechPaused(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }

  function clearTouchFocus() {
    touchFocusedElement.current?.removeAttribute('data-reader-touch-focus');
    touchFocusedElement.current = null;
  }

  function selectTouchTarget(target: HTMLElement) {
    clearTouchFocus();
    touchFocusedElement.current = target;
    target.setAttribute('data-reader-touch-focus', 'true');
    const targets = visiblePageFocusTargets();
    const index = pageFocusTargetIndex(targets, target);
    if (index >= 0) currentFocusIndex.current = index;
    const headings = visiblePageHeadings();
    const headingIndex = headings.findIndex((heading) => heading === target || heading.contains(target));
    if (headingIndex >= 0) currentHeadingIndex.current = headingIndex;
    lastFocusedPageElement.current = target;
    speak(elementLabel(target));
  }

  function currentTouchFocus(): HTMLElement | null {
    const targets = visiblePageFocusTargets();
    if (touchFocusedElement.current && visible(touchFocusedElement.current)) {
      return touchFocusedElement.current;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest('.screen-reader-assistant')) {
      const activeTargetIndex = pageFocusTargetIndex(targets, active);
      if (activeTargetIndex >= 0) return targets[activeTargetIndex];
    }
    if (lastFocusedPageElement.current && targets.includes(lastFocusedPageElement.current)
      && visible(lastFocusedPageElement.current)) {
      return lastFocusedPageElement.current;
    }
    return currentFocusIndex.current >= 0
      ? targets[currentFocusIndex.current] ?? null
      : null;
  }

  function handleTouchTap(target: HTMLElement | null) {
    const focused = currentTouchFocus();
    if (focused) {
      speak(elementLabel(focused));
      return;
    }
    if (target) selectTouchTarget(target);
    else speak(pageHeading());
  }

  function activateCurrentTouchFocus() {
    const focused = currentTouchFocus();
    if (!focused) {
      setAnnouncement('Chưa chọn mục nào. Vuốt trái hoặc phải để chuyển tiêu điểm trước.');
      return;
    }
    activateTouchTarget(focused);
  }

  function activateTouchTarget(target: HTMLElement) {
    clearTouchFocus();
    lastFocusedPageElement.current = target;
    const isHeading = target.matches('h1, h2, h3, h4, h5, h6, [role="heading"]');
    if (isHeading && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (isHeading) {
      speak(`Tiêu đề: ${elementLabel(target)}`);
      return;
    }
    setAnnouncement(`Đã kích hoạt: ${elementLabel(target)}`);
    target.click();
  }

  function cancelPendingSwipeSequence() {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;
    pendingDirection.current = null;
  }

  function handleTouchSwipe(direction: ScreenReaderSwipeDirection) {
    if (direction === 'left') {
      moveFocus('next');
      return;
    }
    if (direction === 'right') {
      moveFocus('previous');
      return;
    }
    recordSwipe(direction);
  }

  useEffect(() => {
    if (!enabled) {
      setExpanded(false);
      setAnnouncement('');
      activeUtterance.current = null;
      setSpeechActive(false);
      setSpeechPaused(false);
      if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
      pendingDirection.current = null;
      previousLocation.current = location;
      return;
    }
    currentFocusIndex.current = -1;
    currentHeadingIndex.current = -1;
    const routeChanged = previousLocation.current !== location;
    previousLocation.current = location;
    if (routeChanged) {
      lastFocusedPageElement.current = null;
      speak(pageHeading());
      return;
    }
    const timer = window.setTimeout(() => {
      const title = pageHeading();
      speak(`Trợ đọc đang bật. ${title}`);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [enabled, location]);

  useEffect(() => {
    if (!enabled) return;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('.screen-reader-assistant')) return;
      clearTouchFocus();
      const targets = visiblePageFocusTargets();
      const targetIndex = pageFocusTargetIndex(targets, target);
      if (targetIndex < 0) return;
      currentFocusIndex.current = targetIndex;
      lastFocusedPageElement.current = targets[targetIndex];
      const headings = visiblePageHeadings();
      const headingIndex = headings.findIndex((heading) => heading === target || heading.contains(target));
      if (headingIndex >= 0) currentHeadingIndex.current = headingIndex;
      const text = elementLabel(targets[targetIndex]);
      if (text && autoReadFocus) speak(text);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [enabled, speechRate, speechVolume, voiceURI, autoReadFocus]);

  useEffect(() => {
    if (!enabled || !touchNavigationEnabled) {
      clearTouchFocus();
      return;
    }
    return attachScreenReaderTouchNavigation({
      resolveTarget: touchFocusTarget,
      onSwipe: handleTouchSwipe,
      onTap: handleTouchTap,
      onActivate: activateCurrentTouchFocus,
      onMultiTouchStart: cancelPendingSwipeSequence,
    });
  }, [
    enabled,
    touchNavigationEnabled,
    focusSwipesEnabled,
    shortcutSwipesEnabled,
    autoReadFocus,
    speechRate,
    speechVolume,
    voiceURI,
    location,
  ]);

  useEffect(() => () => {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    activeUtterance.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  if (!enabled) return null;

  function performAction(action: ScreenReaderAction) {
    if (action === 'employees') {
      navigate('/employees');
      setAnnouncement('Mở quản lý nhân viên.');
      return;
    }
    if (action === 'cards') {
      navigate('/cards');
      setAnnouncement('Mở quản lý thẻ.');
      return;
    }
    if (action === 'home') {
      navigate(location.startsWith('/personal') ? '/personal' : '/');
      setAnnouncement('Trở về trang chính.');
      return;
    }

    const target = safeSaveTarget();
    if (!target) {
      setAnnouncement('Không có biểu mẫu đang mở để lưu.');
      return;
    }
    target.form.requestSubmit(target.button);
    setAnnouncement(`Đã gửi biểu mẫu: ${target.button.innerText.trim()}.`);
  }

  function runSwipeSequence(sequence: readonly ScreenReaderSwipeDirection[]) {
    if (!shortcutSwipesEnabled) {
      setAnnouncement('Cử chỉ lối tắt đang tắt trong Cài đặt.');
      return;
    }
    const action = screenReaderActionForSwipes(sequence);
    if (action) performAction(action);
    else setAnnouncement('Cử chỉ chưa được nhận diện.');
  }

  function moveFocus(direction: ScreenReaderFocusNavigation, fromKeyboard = false) {
    if (!focusSwipesEnabled && !fromKeyboard) {
      setAnnouncement('Vuốt chuyển tiêu điểm đang tắt trong Cài đặt.');
      return;
    }
    const targets = visiblePageFocusTargets();
    if (targets.length === 0) {
      setAnnouncement('Trang này chưa có mục để chuyển tiêu điểm.');
      return;
    }
    const active = document.activeElement;
    const activeTargetIndex = active instanceof HTMLElement
      ? pageFocusTargetIndex(targets, active)
      : -1;
    const touchTargetIndex = touchFocusedElement.current
      ? pageFocusTargetIndex(targets, touchFocusedElement.current)
      : -1;
    const lastFocusedIndex = pageFocusTargetIndex(targets, lastFocusedPageElement.current);
    const storedIndex = currentFocusIndex.current >= 0 && currentFocusIndex.current < targets.length
      ? currentFocusIndex.current
      : -1;
    const currentIndex = touchTargetIndex >= 0
      ? touchTargetIndex
      : lastFocusedIndex >= 0
        ? lastFocusedIndex
        : activeTargetIndex >= 0 ? activeTargetIndex : storedIndex;
    const nextIndex = nextScreenReaderFocusIndex(currentIndex, targets.length, direction);
    if (nextIndex === null) {
      setAnnouncement(direction === 'next' ? 'Đã đến mục cuối cùng.' : 'Đã đến mục đầu tiên.');
      return;
    }

    const target = targets[nextIndex];
    currentFocusIndex.current = nextIndex;
    lastFocusedPageElement.current = target;
    const naturallyFocusable = target.matches('a[href], button, input, select, textarea, [contenteditable="true"]');
    if (!naturallyFocusable && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    const text = elementLabel(target);
    setAnnouncement(`Mục ${nextIndex + 1}/${targets.length}: ${text}`);
    if (!autoReadFocus || active === target) speak(text);
  }

  function moveHeadingFocus(direction: ScreenReaderFocusNavigation, fromKeyboard = false) {
    if (!focusSwipesEnabled && !fromKeyboard) {
      setAnnouncement('Vuốt chuyển tiêu điểm đang tắt trong Cài đặt.');
      return;
    }
    const headings = visiblePageHeadings();
    if (headings.length === 0) {
      setAnnouncement('Trang này chưa có tiêu đề để chuyển đến.');
      return;
    }
    const active = document.activeElement;
    const activeHeadingIndex = active instanceof HTMLElement
      ? pageFocusTargetIndex(headings, active)
      : -1;
    const touchHeadingIndex = touchFocusedElement.current
      ? pageFocusTargetIndex(headings, touchFocusedElement.current)
      : -1;
    const lastHeadingIndex = pageFocusTargetIndex(headings, lastFocusedPageElement.current);
    const storedHeadingIndex = currentHeadingIndex.current >= 0 && currentHeadingIndex.current < headings.length
      ? currentHeadingIndex.current
      : -1;
    const currentIndex = touchHeadingIndex >= 0
      ? touchHeadingIndex
      : lastHeadingIndex >= 0
        ? lastHeadingIndex
        : activeHeadingIndex >= 0 ? activeHeadingIndex : storedHeadingIndex;
    const nextIndex = nextScreenReaderFocusIndex(currentIndex, headings.length, direction);
    if (nextIndex === null) {
      setAnnouncement(direction === 'next' ? 'Đã đến tiêu đề cuối cùng.' : 'Đã đến tiêu đề đầu tiên.');
      return;
    }

    const target = headings[nextIndex];
    currentHeadingIndex.current = nextIndex;
    lastFocusedPageElement.current = target;
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    const text = elementLabel(target);
    setAnnouncement(`Tiêu đề ${nextIndex + 1}/${headings.length}: ${text}`);
    if (!autoReadFocus || active === target) speak(text);
  }

  function readFocusedPageItem() {
    const target = lastFocusedPageElement.current;
    speak(target && visible(target) ? elementLabel(target) : pageHeading());
  }

  function pauseOrResumeSpeech() {
    if (!('speechSynthesis' in window)) {
      setAnnouncement('Trình duyệt không hỗ trợ đọc bằng giọng nói.');
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setSpeechPaused(false);
      setAnnouncement('Đang tiếp tục đọc.');
    } else if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setSpeechPaused(true);
      setAnnouncement('Đã tạm dừng đọc.');
    } else {
      setAnnouncement('Chưa có nội dung nào đang đọc.');
    }
  }

  function stopSpeech() {
    activeUtterance.current = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeechActive(false);
    setSpeechPaused(false);
    setAnnouncement('Đã dừng đọc.');
  }

  function onAssistantKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const action = screenReaderKeyboardActionForKey({
      code: event.code,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (!action || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    switch (action) {
      case 'previous-heading': moveHeadingFocus('previous', true); break;
      case 'next-heading': moveHeadingFocus('next', true); break;
      case 'previous-item': moveFocus('previous', true); break;
      case 'next-item': moveFocus('next', true); break;
      default: performAction(action); break;
    }
  }

  function recordSwipe(direction: ScreenReaderSwipeDirection) {
    const first = pendingDirection.current;
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
    pendingTimer.current = null;

    if (!first) {
      pendingDirection.current = direction;
      pendingTimer.current = window.setTimeout(() => {
        pendingDirection.current = null;
        runSwipeSequence([direction]);
      }, COMBO_WINDOW_MS);
      return;
    }

    pendingDirection.current = null;
    if (first !== direction) {
      runSwipeSequence([first, direction]);
      return;
    }

    // Repeated swipes in the same direction are treated as one single-swipe action.
    pendingDirection.current = direction;
    pendingTimer.current = window.setTimeout(() => {
      pendingDirection.current = null;
      runSwipeSequence([direction]);
    }, COMBO_WINDOW_MS);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isHorizontalSwipe = Math.abs(deltaX) >= SWIPE_DISTANCE_PX
      && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    const isVerticalSwipe = Math.abs(deltaY) >= SWIPE_DISTANCE_PX
      && Math.abs(deltaY) > Math.abs(deltaX) * 1.2;
    if (!isHorizontalSwipe && !isVerticalSwipe) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = true;
    if (isHorizontalSwipe) {
      const direction = deltaX < 0 ? 'left' : 'right';
      const navigation = screenReaderFocusNavigationForSwipe(direction);
      if (navigation) moveFocus(navigation);
    } else {
      recordSwipe(deltaY < 0 ? 'up' : 'down');
    }
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  return (
    <aside
      className={`screen-reader-assistant${expanded ? ' is-expanded' : ''}`}
      aria-label="Trợ đọc SỔ CÔNG"
      onKeyDown={onAssistantKeyDown}
    >
      <button
        type="button"
        className="screen-reader-handle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Thu gọn Trợ đọc SỔ CÔNG' : 'Mở Trợ đọc SỔ CÔNG'}
        aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown Alt+Shift+H Alt+Shift+S Alt+Shift+E Alt+Shift+C"
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setExpanded((value) => !value);
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointerStart.current = null; }}
        data-testid="button-screen-reader-handle"
      >
        <Volume2 size={18} aria-hidden="true" />
        <span>Trợ đọc</span>
      </button>

      {expanded && (
        <section className="screen-reader-panel" aria-labelledby="screen-reader-title">
          <header className="screen-reader-panel-head">
            <h2 id="screen-reader-title">Trợ đọc SỔ CÔNG</h2>
            <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Đóng bảng Trợ đọc">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <p className="screen-reader-status" role="status" aria-live="polite">{announcement || 'Đang bật.'}</p>
          <p className="screen-reader-gestures">
            Chạm 1 lần: đọc tiêu điểm · Chạm 2 lần ở bất kỳ đâu: kích hoạt tiêu điểm · Vuốt trái/phải: mục trước/sau trên toàn trang · Kéo 2 ngón: cuộn
          </p>
          <div className="screen-reader-actions">
            <button type="button" className="btn" onClick={() => speak(pageHeading())} data-testid="button-reader-title">
              <BookOpen size={15} aria-hidden="true" />Đọc tiêu đề
            </button>
            <button type="button" className="btn" onClick={readFocusedPageItem} data-testid="button-reader-focus">
              <Volume2 size={15} aria-hidden="true" />Đọc mục có tiêu điểm
            </button>
            <button type="button" className="btn" onClick={() => moveHeadingFocus('previous')} data-testid="button-reader-previous-heading">
              <ChevronLeft size={15} aria-hidden="true" />Tiêu đề trước
            </button>
            <button type="button" className="btn" onClick={() => moveHeadingFocus('next')} data-testid="button-reader-next-heading">
              <ChevronRight size={15} aria-hidden="true" />Tiêu đề sau
            </button>
            <button type="button" className="btn" onClick={() => moveFocus('previous')} data-testid="button-reader-previous">
              <SkipBack size={15} aria-hidden="true" />Mục trước
            </button>
            <button type="button" className="btn" onClick={() => moveFocus('next')} data-testid="button-reader-next">
              <SkipForward size={15} aria-hidden="true" />Mục sau
            </button>
            <button type="button" className="btn" onClick={() => navigate('/employees')} data-testid="button-reader-employees">
              <Users size={15} aria-hidden="true" />Nhân viên
            </button>
            <button type="button" className="btn" onClick={() => navigate('/cards')} data-testid="button-reader-cards">
              <CreditCard size={15} aria-hidden="true" />Quản lý thẻ
            </button>
            <button type="button" className="btn" onClick={() => performAction('home')} data-testid="button-reader-home">
              <Home size={15} aria-hidden="true" />Trang chính
            </button>
            <button type="button" className="btn" onClick={() => performAction('save')} data-testid="button-reader-save">
              <Save size={15} aria-hidden="true" />Lưu biểu mẫu
            </button>
            <button type="button" className="btn" onClick={pauseOrResumeSpeech} disabled={!speechActive && !speechPaused} data-testid="button-reader-pause">
              {speechPaused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
              {speechPaused ? 'Tiếp tục đọc' : 'Tạm dừng'}
            </button>
            <button type="button" className="btn" onClick={stopSpeech} data-testid="button-reader-stop">
              Dừng đọc
            </button>
          </div>
          <p className="screen-reader-footnote">Vuốt lên: trang chính · Vuốt xuống: lưu · Lên-xuống: nhân viên · Xuống-lên: thẻ. VoiceOver/TalkBack có thể nhận cử chỉ trước ứng dụng.</p>
        </section>
      )}
    </aside>
  );
}
