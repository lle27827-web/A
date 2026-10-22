import { useContext, useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { ScreenReaderContext } from '@/components/screen-reader-context';
import { Modal } from '@/components/modal';
import {
  MAX_SCREEN_READER_RATE,
  MIN_SCREEN_READER_RATE,
  MAX_SCREEN_READER_VOLUME,
  MIN_SCREEN_READER_VOLUME,
} from '@/components/screen-reader-gestures';

function previewSpeech(rate: number, volume: number, voiceURI: string, voices: SpeechSynthesisVoice[]) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Đây là tốc độ giọng đọc hiện tại.');
  utterance.lang = 'vi-VN';
  utterance.rate = rate;
  utterance.volume = volume;
  const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI);
  const vietnameseVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('vi'));
  const voice = selectedVoice ?? vietnameseVoice;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function ScreenReaderSettingsDialog({ onClose }: { onClose: () => void }) {
  const screenReader = useContext(ScreenReaderContext);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synthesis = window.speechSynthesis;
    const updateVoices = () => {
      setVoices(synthesis.getVoices().slice().sort((a, b) => {
        const aVietnamese = a.lang.toLowerCase().startsWith('vi') ? 0 : 1;
        const bVietnamese = b.lang.toLowerCase().startsWith('vi') ? 0 : 1;
        return aVietnamese - bVietnamese || a.name.localeCompare(b.name);
      }));
    };
    updateVoices();
    synthesis.addEventListener('voiceschanged', updateVoices);
    return () => synthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  if (!screenReader) throw new Error('Screen reader settings rendered outside its provider');

  return (
    <Modal
      title="Thiết lập Trợ đọc"
      description="Điều chỉnh giọng đọc và cử chỉ riêng của Trợ đọc."
      onClose={onClose}
      testId="dialog-screen-reader-settings"
    >
      <div className="reader-settings-fields">
        <section className="reader-rate-setting" aria-labelledby="reader-rate-title">
          <div className="reader-rate-heading">
            <label id="reader-rate-title" htmlFor="reader-speech-rate">Tốc độ giọng đọc</label>
            <output htmlFor="reader-speech-rate" data-testid="text-reader-speech-rate">
              {screenReader.speechRate.toFixed(1)}×
            </output>
          </div>
          <input
            id="reader-speech-rate"
            className="reader-speech-range"
            type="range"
            min={MIN_SCREEN_READER_RATE}
            max={MAX_SCREEN_READER_RATE}
            step="0.1"
            value={screenReader.speechRate}
            onChange={(event) => screenReader.setSpeechRate(Number(event.target.value))}
            aria-label="Tốc độ giọng đọc"
            aria-valuetext={`${screenReader.speechRate.toFixed(1)} lần tốc độ`}
            data-testid="input-reader-speech-rate"
          />
          <div className="reader-rate-limits" aria-hidden="true"><span>Chậm</span><span>Nhanh</span></div>
          <label className="reader-setting-label" htmlFor="reader-voice">Giọng đọc</label>
          <select
            id="reader-voice"
            className="reader-voice-select"
            value={voices.some((voice) => voice.voiceURI === screenReader.voiceURI) ? screenReader.voiceURI : ''}
            onChange={(event) => screenReader.setVoiceURI(event.target.value)}
            aria-describedby="reader-voice-help"
            data-testid="select-reader-voice"
          >
            <option value="">Tự chọn giọng tiếng Việt</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>
            ))}
          </select>
          <small id="reader-voice-help" className="reader-settings-help">
            {voices.length ? 'Ưu tiên giọng tiếng Việt khi có sẵn trên thiết bị.' : 'Giọng đọc tùy thuộc trình duyệt và thiết bị.'}
          </small>
          <div className="reader-rate-heading">
            <label htmlFor="reader-speech-volume">Âm lượng Trợ đọc</label>
            <output htmlFor="reader-speech-volume" data-testid="text-reader-speech-volume">
              {Math.round(screenReader.speechVolume * 100)}%
            </output>
          </div>
          <input
            id="reader-speech-volume"
            className="reader-speech-range"
            type="range"
            min={MIN_SCREEN_READER_VOLUME}
            max={MAX_SCREEN_READER_VOLUME}
            step="0.1"
            value={screenReader.speechVolume}
            onChange={(event) => screenReader.setSpeechVolume(Number(event.target.value))}
            aria-label="Âm lượng giọng đọc Trợ đọc"
            aria-valuetext={`${Math.round(screenReader.speechVolume * 100)} phần trăm`}
            data-testid="input-reader-speech-volume"
          />
          <small className="reader-settings-help">Chỉ đổi giọng Trợ đọc, không điều khiển âm lượng VoiceOver/TalkBack.</small>
          <button
            type="button"
            className="btn ghost"
            onClick={() => previewSpeech(screenReader.speechRate, screenReader.speechVolume, screenReader.voiceURI, voices)}
            data-testid="button-reader-preview-rate"
          >
            <Volume2 size={15} aria-hidden="true" />Nghe thử
          </button>
        </section>

        <section className="reader-gesture-settings" aria-labelledby="reader-gestures-title">
          <h3 id="reader-gestures-title">Cử chỉ Trợ đọc</h3>
          <label className="reader-settings-toggle">
            <input
              type="checkbox"
              checked={screenReader.autoReadFocus}
              onChange={(event) => screenReader.setAutoReadFocus(event.target.checked)}
              data-testid="switch-reader-auto-focus"
            />
            <span><strong>Tự đọc khi chuyển tiêu điểm</strong><small>Tắt mục này nếu VoiceOver/TalkBack đang đọc trùng.</small></span>
          </label>

          <label className="reader-settings-toggle">
            <input
              type="checkbox"
              checked={screenReader.focusSwipesEnabled}
              onChange={(event) => screenReader.setFocusSwipesEnabled(event.target.checked)}
              data-testid="switch-reader-focus-gestures"
            />
            <span><strong>Vuốt trên nút Trợ đọc để chuyển tiêu đề</strong><small>Dùng nút hoặc phím tắt để duyệt mọi nút, liên kết và ô nhập.</small></span>
          </label>

          <label className="reader-settings-toggle">
            <input
              type="checkbox"
              checked={screenReader.shortcutSwipesEnabled}
              onChange={(event) => screenReader.setShortcutSwipesEnabled(event.target.checked)}
              data-testid="switch-reader-shortcut-gestures"
            />
            <span><strong>Bật cử chỉ lối tắt lên/xuống</strong><small>Vuốt lên: trang chính · Vuốt xuống: lưu biểu mẫu · Vuốt lên rồi xuống: Nhân viên · Vuốt xuống rồi lên: Thẻ.</small></span>
          </label>

          <div className="reader-gesture-help" role="note">
            Phím tắt khi tiêu điểm ở Trợ đọc: Alt+Shift+←/→ tiêu đề, ↑/↓ mọi mục, H trang chính, S lưu, E nhân viên, C thẻ. Vuốt chỉ nhận trên nút nổi; VoiceOver/TalkBack vẫn xử lý chạm hai lần.
          </div>
        </section>
      </div>
    </Modal>
  );
}
