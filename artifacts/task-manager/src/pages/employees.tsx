import { useMemo, useState } from 'react';
import { getListTreatmentCardsQueryKey, useCreateMember, useCreateServiceSession, useDeleteMember, useListTreatmentCards } from '@workspace/api-client-react';
import type { MemberRecord, ServiceSessionInput } from '@workspace/api-client-react';
import { ArrowLeft, ChevronRight, ClipboardCheck, Eye, LockKeyhole, Plus, Trash2, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { MemberDialog } from '@/components/entity-dialogs';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { SessionDialog } from '@/components/session-dialog';
import { initial, localDate, normalize } from '@/lib/attendance';
import { errorText, useRefreshMassage } from '@/lib/massage';

export default function EmployeesPage() {
  const { members, membersLoading, membersError, retryMembers, canEdit, query, notify, fail } = useShell();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [choice, setChoice] = useState<MemberRecord | null>(null);
  const [quick, setQuick] = useState<MemberRecord | null>(null);
  const [quickDate, setQuickDate] = useState(localDate());
  const create = useCreateMember();
  const del = useDeleteMember();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const createSession = useCreateServiceSession();
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), enabled: canEdit && quick !== null } });
  const refresh = useRefreshMassage();
  const list = useMemo(() => members.filter((m) => normalize(m.name).includes(normalize(query))), [members, query]);

  function submitQuick(input: ServiceSessionInput) {
    if (!canEdit || !quick) return;
    const name = quick.name;
    setDialogError('');
    createSession.mutate({ data: input }, {
      onSuccess: () => { refresh(); setQuick(null); notify(`Đã chấm công cho ${name}.`); },
      onError: (e) => { setDialogError(errorText(e)); fail(e); },
    });
  }

  function askDelete(m: MemberRecord) {
    if (!canEdit) return;
    setConfirm({
      title: `Xóa nhân viên ${m.name}?`,
      body: <p>Xóa {m.name} cũng sẽ xóa toàn bộ ca, lịch sử sử dụng thẻ và lương đã ghi của nhân viên này khỏi báo cáo. Không thể hoàn tác.</p>,
      confirmLabel: 'Xóa nhân viên',
      onConfirm: () => del.mutate({ id: m.id }, { onSuccess: () => { refresh({ members: true }); setConfirm(null); notify(`Đã xóa nhân viên ${m.name}.`); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }

  return (
    <section className="panel page" aria-labelledby="emp-title">
      <Link href="/" className="back" data-testid="link-back"><ArrowLeft size={15} />Trang chính</Link>
      <div className="panel-head wrap">
        <div><h1 id="emp-title" className="page-title">Quản lý nhân viên</h1><p className="sub">{members.length} nhân viên</p></div>
        {canEdit ? <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }} data-testid="button-add-member"><Plus size={15} />Thêm nhân viên</button>
          : <span className="view-only"><LockKeyhole size={13} />Chỉ xem</span>}
      </div>
      {membersLoading ? <Skeleton rows={5} label="Đang tải nhân viên" /> : membersError ? <ErrorBanner text="Không tải được danh sách nhân viên." onRetry={retryMembers} /> : list.length === 0 ? (
        <div className="empty"><Users size={22} /><p>{members.length ? 'Không có nhân viên khớp tìm kiếm.' : 'Chưa có nhân viên nào.'}</p>
          {canEdit && !members.length && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }}><Plus size={15} />Thêm nhân viên đầu tiên</button>}</div>
      ) : (
        <ul className="emp-list">
          {list.map((m) => (
            <li key={m.id} className="emp-item">
              <button type="button" className="emp-row as-row" onClick={() => setChoice(m)} aria-haspopup="dialog" data-testid={`button-employee-${m.id}`}>
                <span className="initials big">{initial(m.name)}</span>
                <span className="grow"><strong>{m.name}</strong><span className="muted">Chấm công · Chi tiết</span></span>
                <ChevronRight size={18} />
              </button>
              {canEdit && <button type="button" className="icon-btn danger" disabled={del.isPending} onClick={() => askDelete(m)} aria-label={`Xóa nhân viên ${m.name}`} data-testid={`button-delete-member-${m.id}`}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
      {choice && (
        <Modal title={choice.name} onClose={() => setChoice(null)} testId="dialog-employee-choice">
          <div className="choice-list">
            <button type="button" className="choice-row" disabled={!canEdit} aria-describedby={canEdit ? undefined : 'choice-lock'}
              onClick={() => { if (!canEdit) return; setDialogError(''); setQuickDate(localDate()); setQuick(choice); setChoice(null); }} data-testid="button-choice-attendance">
              <ClipboardCheck size={18} /><span className="grow"><strong>Chấm công</strong><span className="muted">Hôm nay</span></span><ChevronRight size={16} />
            </button>
            {!canEdit && <p id="choice-lock" className="hint warn"><LockKeyhole size={12} /> Cần quyền chủ sở hữu hoặc quản lý, ở chế độ Chủ.</p>}
            <button type="button" className="choice-row" onClick={() => { const id = choice.id; setChoice(null); navigate(`/employees/${id}`); }} data-testid="button-choice-detail">
              <Eye size={18} /><span className="grow"><strong>Xem chi tiết</strong><span className="muted">Lương, lịch sử ca</span></span><ChevronRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {quick && canEdit && (
        <SessionDialog session={null} members={members} cards={cardsQuery.data ?? []} cardsLoading={cardsQuery.isLoading} defaultDate={quickDate} fixedMemberId={quick.id}
          busy={createSession.isPending} serverError={dialogError} onClose={() => setQuick(null)} onSubmit={submitQuick} />
      )}
      {open && canEdit && (
        <MemberDialog member={null} busy={create.isPending} serverError={dialogError} onClose={() => setOpen(false)}
          onSubmit={({ name }) => create.mutate({ data: { name } }, {
            onSuccess: (m) => { refresh({ members: true }); setOpen(false); notify(`Đã thêm nhân viên ${m.name}.`); navigate(`/employees/${m.id}`); },
            onError: (e) => { setDialogError(errorText(e)); fail(e); },
          })} />
      )}
      {confirm && <ConfirmDialog state={confirm} busy={del.isPending} onClose={() => setConfirm(null)} />}
    </section>
  );
}
