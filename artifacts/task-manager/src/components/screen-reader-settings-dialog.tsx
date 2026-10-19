import { useContext } from 'react';
import { Volume2 } from 'lucide-react';
import { ScreenReaderContext } from '@/components/screen-reader-context';
import { Modal } from '@/components/modal';
import {
  MAX_SCREEN_READER_RATE,
  MIN_SCREEN_READER_RATE,
} from '@/components/screen-reader-gestures';

function previewSpeech(rate: number) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Đây là tốc độ giọng đọc hiện tại.');
  utterance.lang = 'vi-VN';
  utterance.rate = rate;
  const vietnameseVoice = window.speechSynthesis.getVoices()
    .find((voice) => voice.lang.toLowerCase().startsWith('vi'));
  if (vietnameseVoice) utterance.voice = vietnameseVoice;
  window.speechSynthesis.speak(utterance);
}

export function ScreenReaderSettingsDialog({ onClose }: { onClose: () => void }) {
  const screenReader = useContext(ScreenReaderContext);
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
          <button
            type="button"
            className="btn ghost"
            onClick={() => previewSpeech(screenReader.speechRate)}
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
              checked={screenReader.focusSwipesEnabled}
              onChange={(event) => screenReader.setFocusSwipesEnabled(event.target.checked)}
              data-testid="switch-reader-focus-gestures"
            />
            <span><strong>Vuốt trái/phải để chuyển tiêu điểm</strong><small>Duyệt lần lượt tiêu đề, nút, liên kết và ô nhập trên trang.</small></span>
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
            Khi dùng VoiceOver hoặc TalkBack, chạm hai lần để kích hoạt mục đang được chọn. Vuốt tùy chỉnh chỉ nhận trên nút nổi Trợ đọc.
          </div>
        </section>
      </div>
    </Modal>
  );
}
