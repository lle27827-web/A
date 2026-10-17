import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ForwardedRef, type RefObject } from 'react';
import { Mic, MicOff } from 'lucide-react';

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { results: ArrayLike<SpeechResult> };
type SpeechErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechConstructor = new () => SpeechRecognitionLike;

function speechConstructor(): SpeechConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechConstructor;
    webkitSpeechRecognition?: SpeechConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function useVoiceEntry(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('');
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const supported = !!speechConstructor();

  useEffect(() => () => {
    const active = recognition.current;
    if (!active) return;
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    active.stop();
    recognition.current = null;
  }, []);

  function toggle() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const Recognition = speechConstructor();
    const element = ref.current;
    if (!Recognition || !element) return;

    const initialValue = element.value;
    const selectionStart = element.selectionStart ?? initialValue.length;
    const selectionEnd = element.selectionEnd ?? selectionStart;
    const instance = new Recognition();
    recognition.current = instance;
    instance.lang = 'vi-VN';
    instance.continuous = true;
    instance.interimResults = false;
    setStatus('Đang nghe tiếng Việt. Chạm micro để dừng.');
    setListening(true);

    instance.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index])
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(' ');
      if (!transcript) return;

      const before = initialValue.slice(0, selectionStart);
      const after = initialValue.slice(selectionEnd);
      const leadingSpace = before && !/\s$/.test(before) ? ' ' : '';
      const trailingSpace = after && !/^\s/.test(after) ? ' ' : '';
      const insertion = `${leadingSpace}${transcript}${trailingSpace}`;
      const value = `${before}${insertion}${after}`;
      const setter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      const caret = before.length + insertion.length;
      element.focus();
      element.setSelectionRange(caret, caret);
    };
    instance.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Hãy cho phép trình duyệt dùng micro để nhập giọng nói.',
        'service-not-allowed': 'Trình duyệt không cho phép dùng dịch vụ nhận diện giọng nói.',
        'no-speech': 'Chưa nhận được giọng nói. Anh thử lại nhé.',
        network: 'Không kết nối được dịch vụ nhận diện giọng nói.',
      };
      setStatus(messages[event.error] ?? 'Không thể nhập giọng nói. Anh thử lại nhé.');
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
      setStatus((current) => current.startsWith('Đang nghe') ? '' : current);
    };

    try {
      instance.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setStatus('Không thể bật micro. Anh thử lại nhé.');
    }
  }

  return { listening, status, supported, toggle };
}

function VoiceButton({ listening, supported, onClick }: {
  listening: boolean;
  supported: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`voice-input-button${listening ? ' is-listening' : ''}`}
      onClick={onClick}
      disabled={!supported}
      aria-label={!supported ? 'Trình duyệt không hỗ trợ nhập giọng nói' : listening ? 'Dừng nhập giọng nói' : 'Nhập bằng giọng nói'}
      aria-pressed={listening}
      title={!supported ? 'Trình duyệt không hỗ trợ nhập giọng nói' : listening ? 'Dừng nhập giọng nói' : 'Nhập bằng giọng nói'}
      data-testid="button-voice-input"
    >
      {listening ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}
    </button>
  );
}

type VoiceInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'> & { type?: 'text' | 'search' };

export const VoiceInput = forwardRef<HTMLInputElement, VoiceInputProps>(function VoiceInput(
  { className, type = 'text', ...props },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { listening, status, supported, toggle } = useVoiceEntry(inputRef);
  return (
    <div className="voice-input-shell">
      <input
        {...props}
        ref={(element) => { inputRef.current = element; assignRef(forwardedRef, element); }}
        type={type}
        className={className}
      />
      <VoiceButton listening={listening} supported={supported} onClick={toggle} />
      <span className="sr-only" aria-live="polite">{status}</span>
    </div>
  );
});

type VoiceTextareaProps = ComponentPropsWithoutRef<'textarea'>;

export const VoiceTextarea = forwardRef<HTMLTextAreaElement, VoiceTextareaProps>(function VoiceTextarea(
  { className, ...props },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { listening, status, supported, toggle } = useVoiceEntry(textareaRef);
  return (
    <div className="voice-input-shell voice-textarea-shell">
      <textarea
        {...props}
        ref={(element) => { textareaRef.current = element; assignRef(forwardedRef, element); }}
        className={className}
      />
      <VoiceButton listening={listening} supported={supported} onClick={toggle} />
      <span className="sr-only" aria-live="polite">{status}</span>
    </div>
  );
});
