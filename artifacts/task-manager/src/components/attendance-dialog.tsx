import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { AttendanceInput, AttendanceRecord, MemberRecord } from '@workspace/api-client-react';
import { LoaderCircle, X } from 'lucide-react';
import { Form } from '@/components/ui/form';
import { STATUS_OPTIONS } from '@/lib/attendance';

export function AttendanceDialog({ record, members, busy, error, initialDate, initialMemberId, onClose, onSubmit }: {
  record: AttendanceRecord | null;
  members: MemberRecord[];
  busy: boolean;
  error: string;
  initialDate: string;
  initialMemberId?: number | null;
  onClose: () => void;
  onSubmit: (input: AttendanceInput) => void;
}) {
  const startMember = record ? record.memberId ?? 0 : initialMemberId ?? members[0]?.id ?? 0;
  const form = useForm<AttendanceInput>({
    defaultValues: record
      ? { memberId: startMember, employeeName: record.employeeName, workDate: record.workDate, checkIn: record.checkIn ?? '', checkOut: record.checkOut ?? '', status: record.status, note: record.note ?? '' }
      : { memberId: startMember, employeeName: members.find((m) => m.id === startMember)?.name ?? '', workDate: initialDate, checkIn: '', checkOut: '', status: 'present', note: '' },
  });
  const validation = form.formState.errors.memberId?.message ?? form.formState.errors.workDate?.message;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onClose]);

  function submit(values: AttendanceInput) {
    const memberId = Number(values.memberId);
    const member = members.find((m) => m.id === memberId);
    onSubmit({
      memberId,
      employeeName: member?.name ?? values.employeeName.trim(),
      workDate: values.workDate,
      status: values.status,
      checkIn: values.checkIn || null,
      checkOut: values.checkOut || null,
      note: values.note?.trim() || null,
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title" onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const els = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
        const first = els[0]; const last = els[els.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <div className="dialog-head">
          <h2 id="attendance-dialog-title">{record ? 'Sửa ca làm' : 'Ghi nhận ca làm'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Đóng hộp thoại" data-testid="button-close-attendance-dialog"><X size={18} /></button>
        </div>
        {members.length === 0 && !record ? (
          <p className="form-error" role="alert">Hãy thêm thành viên trước khi ghi nhận ca làm.</p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="form-grid">
              <label className="field" htmlFor="attendance-member">Thành viên
                <select id="attendance-member" autoFocus {...form.register('memberId', { valueAsNumber: true, min: { value: record?.memberId === null ? 0 : 1, message: 'Hãy chọn thành viên.' } })} data-testid="select-attendance-member">
                  <option value={0}>{record && record.memberId === null ? `${record.employeeName} (đã xóa)` : 'Chọn thành viên'}</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field" htmlFor="attendance-work-date">Ngày làm việc
                <input id="attendance-work-date" type="date" {...form.register('workDate', { required: 'Hãy chọn ngày làm việc.' })} data-testid="input-attendance-work-date" />
              </label>
              <div className="field-row">
                <label className="field" htmlFor="attendance-check-in">Vào ca<input id="attendance-check-in" type="time" {...form.register('checkIn')} data-testid="input-attendance-check-in" /></label>
                <label className="field" htmlFor="attendance-check-out">Tan ca<input id="attendance-check-out" type="time" {...form.register('checkOut')} data-testid="input-attendance-check-out" /></label>
              </div>
              <label className="field" htmlFor="attendance-status">Tình trạng
                <select id="attendance-status" {...form.register('status')} data-testid="select-attendance-form-status">
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field" htmlFor="attendance-note">Ghi chú
                <textarea id="attendance-note" rows={3} maxLength={2000} {...form.register('note')} placeholder="Ví dụ: đổi ca với Lan" data-testid="input-attendance-note" />
              </label>
              {(validation || error) && <p className="form-error" role="alert" data-testid="status-attendance-form-error">{validation || error}</p>}
              <div className="dialog-actions">
                <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Hủy</button>
                <button type="submit" className="btn primary" disabled={busy} data-testid="button-save-attendance">{busy && <LoaderCircle className="spin" size={15} />}{record ? 'Lưu thay đổi' : 'Ghi nhận'}</button>
              </div>
            </form>
          </Form>
        )}
      </section>
    </div>
  );
}
