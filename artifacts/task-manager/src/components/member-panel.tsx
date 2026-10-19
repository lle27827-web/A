import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { AttendanceRecord, MemberInput, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, LoaderCircle, Plus, Trash2, Users, X } from 'lucide-react';
import { Form } from '@/components/ui/form';
import { initial } from '@/lib/attendance';
import { AttendanceTable, TableSkeleton } from '@/components/attendance-table';

export function MemberList({ members, selectedId, canEdit, loading, error, busy, onRetry, onSelect, onCreate, onDelete }: {
  members: MemberRecord[];
  selectedId: number | null;
  canEdit: boolean;
  loading: boolean;
  error: boolean;
  busy: boolean;
  onRetry: () => void;
  onSelect: (id: number | null) => void;
  onCreate: (input: MemberInput, done: () => void) => void;
  onDelete: (member: MemberRecord) => void;
}) {
  const [adding, setAdding] = useState(false);
  const form = useForm<MemberInput>({ defaultValues: { name: '' } });

  return (
    <section className="panel members" aria-labelledby="members-title" data-testid="section-members">
      <div className="panel-head">
        <h2 id="members-title">Nhân viên <span className="count" data-testid="text-member-count">{loading ? '…' : members.length}</span></h2>
        {canEdit && <button type="button" className="btn small" onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="button-add-member"><Plus size={14} />Thêm</button>}
      </div>
      {adding && canEdit && (
        <Form {...form}>
          <form className="member-form" onSubmit={form.handleSubmit((values) => onCreate({ name: values.name.trim() }, () => { form.reset({ name: '' }); setAdding(false); }))}>
            <label className="sr-only" htmlFor="member-name">Tên Nhân viên</label>
            <input id="member-name" autoFocus maxLength={120} placeholder="Tên Nhân viên" {...form.register('name', { validate: (v) => v.trim().length > 0 || 'Hãy nhập tên Nhân viên.' })} data-testid="input-member-name" />
            <button type="submit" className="btn primary small" disabled={busy} data-testid="button-save-member">{busy ? <LoaderCircle className="spin" size={14} /> : 'Lưu'}</button>
            <button type="button" className="icon-btn" onClick={() => setAdding(false)} aria-label="Hủy thêm Nhân viên"><X size={15} /></button>
            {form.formState.errors.name && <p className="form-error" role="alert">{form.formState.errors.name.message}</p>}
          </form>
        </Form>
      )}
      {error ? (
        <div className="banner danger" role="alert" data-testid="status-members-error"><AlertCircle size={15} /><span>Không tải được Nhân viên.</span><button type="button" onClick={onRetry}>Thử lại</button></div>
      ) : loading ? <TableSkeleton label="Đang tải Nhân viên" /> : members.length === 0 ? (
        <div className="empty small" data-testid="status-empty-members"><Users size={18} /><p>Chưa có Nhân viên.{canEdit ? ' Thêm người đầu tiên để bắt đầu.' : ''}</p></div>
      ) : (
        <ul className="member-list" aria-label="Danh sách Nhân viên" data-testid="list-members">
          {members.map((m) => (
            <li key={m.id} className={selectedId === m.id ? 'selected' : ''}>
              <button type="button" className="member-btn" onClick={() => onSelect(selectedId === m.id ? null : m.id)} aria-pressed={selectedId === m.id} data-testid={`button-select-member-${m.id}`}>
                <span className="initials" aria-hidden="true">{initial(m.name)}</span>
                <span className="member-name">{m.name}</span>
              </button>
              {canEdit && <button type="button" className="icon-btn danger" onClick={() => onDelete(m)} disabled={busy} aria-label={`Xóa Nhân viên ${m.name}`} data-testid={`button-delete-member-${m.id}`}><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MemberHistory({ member, records, loading, error, canEdit, busy, onRetry, onClose, onEdit, onDelete, onAdd }: {
  member: MemberRecord;
  records: AttendanceRecord[];
  loading: boolean;
  error: boolean;
  canEdit: boolean;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
  onEdit: (r: AttendanceRecord) => void;
  onDelete: (r: AttendanceRecord) => void;
  onAdd: () => void;
}) {
  const sorted = [...records].sort((a, b) => b.workDate.localeCompare(a.workDate) || (b.checkIn ?? '').localeCompare(a.checkIn ?? ''));
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  sorted.forEach((r) => { counts[r.status] += 1; });
  return (
    <section className="panel" aria-labelledby="history-title" data-testid="section-member-history">
      <div className="panel-head">
        <div>
          <h2 id="history-title">Lịch sử ca: {member.name}</h2>
          <p className="sub" data-testid="text-history-stats">{sorted.length} ca · {counts.present} có mặt · {counts.late} muộn · {counts.absent} vắng · {counts.leave} nghỉ phép</p>
        </div>
        <div className="head-actions">
          {canEdit && <button type="button" className="btn small" onClick={onAdd} data-testid="button-add-member-shift"><Plus size={14} />Thêm ca</button>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Đóng lịch sử Nhân viên" data-testid="button-close-member-history"><X size={16} /></button>
        </div>
      </div>
      {error ? (
        <div className="banner danger" role="alert"><AlertCircle size={15} /><span>Không tải được lịch sử ca.</span><button type="button" onClick={onRetry}>Thử lại</button></div>
      ) : loading ? <TableSkeleton label="Đang tải lịch sử ca" /> : sorted.length === 0 ? (
        <div className="empty small" data-testid="status-empty-history"><p>Nhân viên này chưa có ca nào được ghi nhận.</p></div>
      ) : (
        <AttendanceTable records={sorted} caption={`Toàn bộ ca làm của ${member.name}, mới nhất trước`} canEdit={canEdit} showDate busy={busy} onEdit={onEdit} onDelete={onDelete} testId="member-history" />
      )}
    </section>
  );
}
