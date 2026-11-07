import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Keyboard, Pencil, Trash2 } from 'lucide-react';
import {
  blockedShortcutReason,
  formatShortcutLabel,
  readDeviceShortcutBindings,
  shortcutFromKeyboardEvent,
  writeDeviceShortcutBindings,
  type KeyboardShortcutAction,
  type KeyboardShortcutBindings,
} from '@/lib/keyboard-shortcuts';

export function KeyboardShortcutsSettings({ actions }: { actions: KeyboardShortcutAction[] }) {
  const [bindings, setBindings] = useState<KeyboardShortcutBindings>(readDeviceShortcutBindings);
  const [selectedActionId, setSelectedActionId] = useState(actions[0]?.id ?? '');
  const [recording, setRecording] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [status, setStatus] = useState('');
  const captureRef = useRef<HTMLButtonElement>(null);
  const visibleBindings = actions
    .map((action) => ({ action, combination: bindings[action.id] }))
    .filter((item): item is { action: KeyboardShortcutAction; combination: string } => Boolean(item.combination));
  const selectedAction = actions.find((action) => action.id === selectedActionId);

  useEffect(() => {
    if (!actions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId(actions[0]?.id ?? '');
    }
  }, [actions, selectedActionId]);

  useEffect(() => {
    if (recording) captureRef.current?.focus();
  }, [recording]);

  function saveCombination(combination: string) {
    const conflict = Object.entries(bindings).find(([actionId, assigned]) =>
      assigned === combination && actionId !== selectedActionId,
    );
    if (conflict) {
      const conflictLabel = actions.find((action) => action.id === conflict[0])?.label;
      setStatus(conflictLabel
        ? `Tổ hợp này đã gán cho ${conflictLabel}.`
        : 'Tổ hợp này đã được gán cho chức năng khác trên thiết bị.');
      return;
    }
    const next = { ...bindings, [selectedActionId]: combination };
    if (!writeDeviceShortcutBindings(next)) {
      setStatus('Không lưu được trên thiết bị này. Hãy kiểm tra quyền lưu của trình duyệt.');
      return;
    }
    setBindings(next);
    setRecording(false);
    setCandidate('');
    setStatus(`Đã gán ${formatShortcutLabel(combination)} cho ${selectedAction?.label ?? 'chức năng'}.`);
  }

  function handleCaptureKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const nativeEvent = event.nativeEvent;
    if (nativeEvent.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setRecording(false);
      setCandidate('');
      setStatus('Đã hủy ghi phím tắt.');
      return;
    }
    if (nativeEvent.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!candidate) {
        setStatus('Nhấn tổ hợp phím trước, rồi nhấn Enter để lưu.');
        return;
      }
      saveCombination(candidate);
      return;
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(nativeEvent.key)) {
      event.preventDefault();
      setStatus('Tiếp tục nhấn thêm một chữ hoặc số.');
      return;
    }

    const combination = shortcutFromKeyboardEvent(nativeEvent);
    if (!combination) {
      setStatus('Dùng phím bổ trợ cùng một chữ hoặc số.');
      return;
    }
    const blockedReason = blockedShortcutReason(combination);
    if (blockedReason) {
      setStatus(blockedReason);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setCandidate(combination);
    setStatus(`Đã nhận ${formatShortcutLabel(combination)}. Nhấn Enter để xác nhận.`);
  }

  function removeCombination(actionId: string) {
    const next = { ...bindings };
    delete next[actionId];
    if (!writeDeviceShortcutBindings(next)) {
      setStatus('Không xóa được phím tắt trên thiết bị này.');
      return;
    }
    setBindings(next);
    setStatus('Đã xóa phím tắt.');
  }

  return (
    <section className="keyboard-shortcuts-settings" aria-labelledby="keyboard-shortcuts-title">
      <h3 id="keyboard-shortcuts-title"><Keyboard size={16} aria-hidden="true" />Phím tắt</h3>
      <p className="sub keyboard-shortcuts-help">
        Lưu trên thiết bị này. Dùng Alt + chữ/số hoặc Ctrl + Shift + số; không ghi đè phím của trình duyệt hay trợ năng.
      </p>
      {actions.length ? (
        <>
          <label className="field" htmlFor="shortcut-action">Chức năng
            <select id="shortcut-action" value={selectedActionId}
              onChange={(event) => { setSelectedActionId(event.target.value); setStatus(''); }}
              disabled={recording} data-testid="select-keyboard-shortcut-action">
              {actions.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn" disabled={!selectedAction}
            onClick={() => { setCandidate(''); setStatus('Nhấn tổ hợp phím, sau đó nhấn Enter để lưu.'); setRecording(true); }}
            data-testid="button-record-keyboard-shortcut">
            {bindings[selectedActionId] ? 'Đổi phím' : 'Gán phím'}
          </button>
          {recording && (
            <div className="shortcut-recording" role="group" aria-label="Ghi tổ hợp phím">
              <button ref={captureRef} type="button" className="shortcut-capture"
                onKeyDown={handleCaptureKey} data-keyboard-shortcut-capture="true"
                data-testid="button-capture-keyboard-shortcut">
                {candidate ? formatShortcutLabel(candidate) : 'Nhấn tổ hợp phím'}
              </button>
              <button type="button" className="btn ghost" onClick={() => { setRecording(false); setCandidate(''); setStatus('Đã hủy ghi phím tắt.'); }}>
                Hủy
              </button>
            </div>
          )}
          {status && <p className="keyboard-shortcut-status" role="status">{status}</p>}
          <ul className="keyboard-shortcut-list" aria-label="Phím tắt đã gán">
            {visibleBindings.map(({ action, combination }) => (
              <li className="keyboard-shortcut-row" key={action.id}>
                <span className="grow">
                  <strong>{action.label}</strong>
                  <span className="muted mono">{formatShortcutLabel(combination)}</span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Sửa phím tắt cho ${action.label}`}
                  onClick={() => { setSelectedActionId(action.id); setCandidate(''); setStatus('Nhấn tổ hợp phím, sau đó nhấn Enter để lưu.'); setRecording(true); }}
                  data-testid={`button-edit-shortcut-${action.id}`}><Pencil size={15} aria-hidden="true" /></button>
                <button type="button" className="icon-btn danger" aria-label={`Xóa phím tắt cho ${action.label}`}
                  onClick={() => removeCombination(action.id)}
                  data-testid={`button-remove-shortcut-${action.id}`}><Trash2 size={15} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          {!visibleBindings.length && <p className="muted">Chưa gán phím tắt.</p>}
        </>
      ) : <p className="muted">Không có chức năng được cấp quyền để gán phím.</p>}
    </section>
  );
}
