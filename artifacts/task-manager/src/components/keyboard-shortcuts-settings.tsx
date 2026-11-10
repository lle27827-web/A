import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Keyboard, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  blockedShortcutReason,
  createDeviceShortcutBindingId,
  discoverDeviceShortcutActions,
  formatShortcutLabel,
  readDeviceShortcutLabels,
  readDeviceShortcutBindings,
  shortcutFromKeyboardEvent,
  writeDeviceShortcutBindings,
  writeDeviceShortcutLabels,
  type KeyboardShortcutAction,
  type KeyboardShortcutBindings,
} from '@/lib/keyboard-shortcuts';

export function KeyboardShortcutsSettings({ actions, storageScope = 'device' }: {
  actions: KeyboardShortcutAction[];
  storageScope?: string;
}) {
  const [bindings, setBindings] = useState<KeyboardShortcutBindings>(() => readDeviceShortcutBindings(storageScope));
  const [screenActions, setScreenActions] = useState<KeyboardShortcutAction[]>([]);
  const [knownLabels, setKnownLabels] = useState<Record<string, string>>(() => readDeviceShortcutLabels(storageScope));
  const [selectedActionId, setSelectedActionId] = useState(actions[0]?.id ?? '');
  const [actionFilter, setActionFilter] = useState('');
  const [recording, setRecording] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [editingBindingId, setEditingBindingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const captureRef = useRef<HTMLButtonElement>(null);
  const availableActions = useMemo(() => {
    const byId = new Map<string, KeyboardShortcutAction>();
    for (const action of [...actions, ...screenActions]) byId.set(action.id, action);
    for (const [id, label] of Object.entries(knownLabels)) {
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        label,
        group: 'Chức năng đã gán · hiện không có trên màn hình',
        ...(id.startsWith('ui-') ? { targetId: id } : {}),
        run: () => {
          if (id.startsWith('ui-')) {
            document.querySelector<HTMLElement>(`[data-keyboard-shortcut-target-id="${id}"]`)?.click();
          }
        },
      });
    }
    return [...byId.values()];
  }, [actions, knownLabels, screenActions]);
  const actionById = useMemo(() => new Map(availableActions.map((action) => [action.id, action])), [availableActions]);
  const filteredActions = useMemo(() => {
    const filter = actionFilter.trim().toLocaleLowerCase('vi');
    if (!filter) return availableActions;
    return availableActions.filter((action) =>
      `${action.group ?? ''} ${action.label}`.toLocaleLowerCase('vi').includes(filter),
    );
  }, [actionFilter, availableActions]);
  const visibleBindings = bindings.map((binding) => ({
    binding,
    action: actionById.get(binding.actionId) ?? {
      id: binding.actionId,
      label: knownLabels[binding.actionId] ?? 'Chức năng đã lưu',
      run: () => undefined,
    },
  }));
  const selectedAction = actionById.get(selectedActionId);

  useEffect(() => {
    setBindings(readDeviceShortcutBindings(storageScope));
    setKnownLabels(readDeviceShortcutLabels(storageScope));
    setScreenActions(discoverDeviceShortcutActions());
  }, [actions, storageScope]);

  useEffect(() => {
    if (!filteredActions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId(filteredActions[0]?.id ?? '');
    }
  }, [filteredActions, selectedActionId]);

  useEffect(() => {
    if (recording) captureRef.current?.focus();
  }, [recording]);

  function saveCombination(combination: string) {
    if (!selectedActionId) {
      setStatus('Trước tiên, hãy chọn chức năng cần gán.');
      return;
    }
    const conflict = bindings.find((binding) =>
      binding.combination === combination && binding.id !== editingBindingId,
    );
    if (conflict) {
      const conflictLabel = actionById.get(conflict.actionId)?.label ?? knownLabels[conflict.actionId];
      setStatus(conflictLabel
        ? `Tổ hợp này đã gán cho ${conflictLabel}.`
        : 'Tổ hợp này đã được gán cho chức năng khác trên thiết bị.');
      return;
    }
    const next = editingBindingId
      ? bindings.map((binding) => binding.id === editingBindingId ? { ...binding, combination } : binding)
      : [...bindings, {
          id: createDeviceShortcutBindingId(),
          actionId: selectedActionId,
          combination,
        }];
    if (!writeDeviceShortcutBindings(next, storageScope)) {
      setStatus('Không lưu được trên thiết bị này. Hãy kiểm tra quyền lưu của trình duyệt.');
      return;
    }
    writeDeviceShortcutLabels(availableActions, next, storageScope);
    setBindings(next);
    setKnownLabels(readDeviceShortcutLabels(storageScope));
    setRecording(false);
    setCandidate('');
    setEditingBindingId(null);
    setStatus(`${editingBindingId ? 'Đã đổi' : 'Đã thêm'} ${formatShortcutLabel(combination)} cho ${selectedAction?.label ?? 'chức năng'}.`);
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

  function removeCombination(bindingId: string) {
    const next = bindings.filter((binding) => binding.id !== bindingId);
    if (!writeDeviceShortcutBindings(next, storageScope)) {
      setStatus('Không xóa được phím tắt trên thiết bị này.');
      return;
    }
    writeDeviceShortcutLabels(availableActions, next, storageScope);
    setBindings(next);
    setKnownLabels(readDeviceShortcutLabels(storageScope));
    setStatus('Đã xóa phím tắt.');
  }

  return (
    <details className="keyboard-shortcuts-settings" aria-labelledby="keyboard-shortcuts-title" data-testid="section-keyboard-shortcuts">
      <summary className="keyboard-shortcuts-summary">
        <span className="keyboard-shortcuts-summary-title" id="keyboard-shortcuts-title">
          <Keyboard size={16} aria-hidden="true" />Phím tắt
        </span>
        <ChevronDown size={18} className="keyboard-shortcuts-chevron" aria-hidden="true" />
      </summary>
      <div className="keyboard-shortcuts-content">
        <p className="sub keyboard-shortcuts-help">
          Gán nhiều phím cho các chức năng trong ứng dụng; có thể dùng nhiều phím khác nhau cho cùng một chức năng. Phím tắt lưu riêng trên thiết bị. Dùng Alt + chữ/số hoặc Ctrl + Shift + số. Phím Lưu chỉ gửi biểu mẫu được hỗ trợ, không xác nhận xóa hay nạp thẻ. Một số tổ hợp được trình duyệt hoặc trợ năng giữ lại sẽ không thể gán.
        </p>
      {availableActions.length ? (
        <>
          <label className="field" htmlFor="shortcut-action-filter">Tìm chức năng
            <input id="shortcut-action-filter" type="search" value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              placeholder="Ví dụ: chấm công cho nhân viên An"
              autoComplete="off" data-testid="input-filter-keyboard-shortcuts" />
          </label>
          {filteredActions.length ? (
            <>
              <label className="field" htmlFor="shortcut-action">Chức năng
                <select id="shortcut-action" value={selectedActionId}
                  onChange={(event) => { setSelectedActionId(event.target.value); setEditingBindingId(null); setStatus(''); }}
                  disabled={recording} data-testid="select-keyboard-shortcut-action">
                  {[...new Set(filteredActions.map((action) => action.group ?? 'Chức năng khác'))].map((group) => (
                    <optgroup key={group} label={group}>
                      {filteredActions.filter((action) => (action.group ?? 'Chức năng khác') === group)
                        .map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button type="button" className="btn" disabled={!selectedAction}
                onClick={() => {
                  setEditingBindingId(null);
                  setCandidate('');
                  setStatus('Nhấn tổ hợp phím, sau đó nhấn Enter để lưu.');
                  setRecording(true);
                }}
                data-testid="button-record-keyboard-shortcut">
                <Plus size={15} aria-hidden="true" />Thêm phím tắt
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
            </>
          ) : <p className="muted" role="status">Không tìm thấy chức năng phù hợp với nội dung tìm kiếm.</p>}
          {status && <p className="keyboard-shortcut-status" role="status">{status}</p>}
          <ul className="keyboard-shortcut-list" aria-label="Phím tắt đã gán">
            {visibleBindings.map(({ binding, action }) => (
              <li className="keyboard-shortcut-row" key={binding.id}>
                <span className="grow">
                  <strong>{action.label}</strong>
                  <span className="muted mono">{formatShortcutLabel(binding.combination)}</span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Sửa phím tắt cho ${action.label}`}
                  onClick={() => {
                    setSelectedActionId(binding.actionId);
                    setEditingBindingId(binding.id);
                    setCandidate('');
                    setStatus('Nhấn tổ hợp phím mới, sau đó nhấn Enter để lưu.');
                    setRecording(true);
                  }}
                  data-testid={`button-edit-shortcut-${binding.id}`}><Pencil size={15} aria-hidden="true" /></button>
                <button type="button" className="icon-btn danger" aria-label={`Xóa phím tắt cho ${action.label}`}
                  onClick={() => removeCombination(binding.id)}
                  data-testid={`button-remove-shortcut-${binding.id}`}><Trash2 size={15} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          {!visibleBindings.length && <p className="muted">Chưa gán phím tắt.</p>}
        </>
      ) : <p className="muted">Không có chức năng được cấp quyền để gán phím.</p>}
      </div>
    </details>
  );
}
