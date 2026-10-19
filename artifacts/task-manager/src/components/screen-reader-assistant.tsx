import { useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, CreditCard, Home, Save, Volume2, Users, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { ScreenReaderContext } from '@/components/screen-reader-context';
import {
  isSafeSaveLabel,
  screenReaderActionForSwipes,
  type ScreenReaderAction,
  type ScreenReaderSwipeDirection,
} from './screen-reader-gestures';

const COMBO_WINDOW_MS = 650;
const SWIPE_DISTANCE_PX = 36;

function visible(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== 'hidden';
}

function pageHeading(): string {
  const main = document.querySelector<HTMLElement>('#main, .p-main');
  const heading = main?.querySelector<HTMLElement>('h1, h2');
  return heading?.innerText.trim() || document.title || 'SỔ CÔNG';
}

function elementLabel(active: HTMLElement): string {
  const explicit = active.getAttribute('aria-label');
  if (explicit) return explicit.trim();

  const labelledBy = active.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
    if (active instanceof HTMLInputElement && active.type === 'password') {
      return active.labels?.[0]?.innerText.trim() || 'Ô nhập mật khẩu';
    }
    const label = active.labels?.[0]?.innerText.trim()
      || active.getAttribute('placeholder')
      || active.getAttribute('title')
      || 'Ô nhập liệu';
    if (active instanceof HTMLSelectElement) {
      const choice = active.selectedOptions[0]?.textContent?.trim();
      return choice ? `${label}: ${choice}` : label;
    }
    return active.value ? `${label}: ${active.value}` : label;
  }

  const text = (active.innerText || active.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 100) || '';
}

function focusedElementLabel(): string {
  const active = document.activeElement;
  return active instanceof HTMLElement ? elementLabel(active) || pageHeading() : pageHeading();
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
  const { enabled } = useScreenReaderAssistant();
  const [location, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const pendingDirection = useRef<ScreenReaderSwipeDirection | null>(null);
  const pendingTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const previousLocation = useRef(location);
  function speak(text: string) {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    if (!cleanText) return;
    setAnnouncement(cleanText);
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setAnnouncement('Trình duyệt không hỗ trợ đọc bằng giọng nói.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.95;
    const vietnameseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('vi'));
    if (vietnameseVoice) utterance.voice = vietnameseVoice;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    if (!enabled) {
      setExpanded(false);
      setAnnouncement('');
      if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
      pendingDirection.current = null;
      previousLocation.current = location;
      return;
    }
    const routeChanged = previousLocation.current !== location;
    previousLocation.current = location;
    if (routeChanged) {
      setAnnouncement(pageHeading());
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
      const text = elementLabel(target);
      if (text) speak(text);
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [enabled]);

  useEffect(() => () => {
    if (pendingTimer.current) window.clearTimeout(pendingTimer.current);
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
    const action = screenReaderActionForSwipes(sequence);
    if (action) performAction(action);
    else setAnnouncement('Cử chỉ chưa được nhận diện.');
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
    if (Math.abs(deltaY) < SWIPE_DISTANCE_PX || Math.abs(deltaY) <= Math.abs(deltaX) * 1.2) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = true;
    recordSwipe(deltaY < 0 ? 'up' : 'down');
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  return (
    <aside className={`screen-reader-assistant${expanded ? ' is-expanded' : ''}`} aria-label="Trợ đọc SỔ CÔNG">
      <button
        type="button"
        className="screen-reader-handle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Thu gọn Trợ đọc SỔ CÔNG' : 'Mở Trợ đọc SỔ CÔNG'}
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
            <button type="button" className="icon-btn" onClick={() => setExpanded(false)} aria-label="Thu gọn Trợ đọc">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <p className="screen-reader-status" role="status" aria-live="polite">{announcement || 'Đang bật.'}</p>
          <p className="screen-reader-gestures">
            Vuốt lên rồi xuống: Nhân viên · Xuống rồi lên: Thẻ · Lên: Trang chính · Xuống: Lưu
          </p>
          <div className="screen-reader-actions">
            <button type="button" className="btn" onClick={() => speak(pageHeading())} data-testid="button-reader-title">
              <BookOpen size={15} aria-hidden="true" />Đọc tiêu đề
            </button>
            <button type="button" className="btn" onClick={() => speak(focusedElementLabel())} data-testid="button-reader-focus">
              <Volume2 size={15} aria-hidden="true" />Đọc mục đang chọn
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
            <button type="button" className="btn" onClick={() => {
              if ('speechSynthesis' in window) window.speechSynthesis.cancel();
              setAnnouncement('Đã dừng đọc.');
            }} data-testid="button-reader-stop">
              Dừng đọc
            </button>
          </div>
          <p className="screen-reader-footnote">Cử chỉ chỉ nhận trên nút Trợ đọc. VoiceOver và TalkBack vẫn giữ cử chỉ hệ thống.</p>
        </section>
      )}
    </aside>
  );
}
