import { useMemo, useState } from 'react';
import {
  getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey,
  useCreateMember, useCreateServiceSession, useDeleteMember, useListServiceSessions, useListTreatmentCards,
} from '@workspace/api-client-react';
import type { MemberRecord, ServiceSessionInput } from '@workspace/api-client-react';
import { ChevronRight, ClipboardCheck, Eye, Plus, Trash2, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { MemberDialog } from '@/components/entity-dialogs';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { SessionDialog } from '@/components/session-dialog';
import { initial, localDate, normalize, formatShortDate } from '@/lib/attendance';
import { errorText, formatMinutes, formatMonth, formatVnd, SESSION_FRESHNESS, useRefreshMassage } from '@/lib/massage';
import { summarizeEmployeeSessions } from '@/lib/employee-list-summary';

export function MemberTags({ member }: { member: MemberRecord }) {
  const deleted = !!member.deletedAt;
  const unverified = member.historicalNameSource === 'unverified';
  if (!deleted && !unverified) return null;
  return (
    <span className="name-tags">
      {deleted && <span className="tag" data-testid={`status-member-deleted-${member.id}`}>Đã ẩn ở hiện tại</span>}
      {unverified && <span className="tag warn" title="Tên cũ của tháng này chưa được ghi lại; đang hiển thị tên hiện tại." data-testid={`status-member-unverified-${member.id}`}>Tên chưa xác minh</span>}
    </span>
  );
}

export default function EmployeesPage() {
  const { members, membersLoading, membersError, retryMembers, canViewEmployees, canEditEmployees: canEdit, canDeleteEmployees, canAddEmployees, canEditCards, query, notify, fail, historyMonth, period, withHistory } = useShell();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [choice, setChoice] = useState<MemberRecord | null>(null);
  const [quick, setQuick] = useState<MemberRecord | null>(null);
  const [quickDate, setQuickDate] = useState(localDate());
  const create = useCreateMember();
  const del = useDeleteMember();
  const sessionParams = useMemo(() => ({ month: period.month }), [period.month]);
  const sessionsQuery = useListServiceSessions(sessionParams, {
    query: {
      queryKey: getListServiceSessionsQueryKey(sessionParams),
      enabled: canViewEmployees,
      ...SESSION_FRESHNESS,
    },
  });
  const summaries = useMemo(() => summarizeEmployeeSessions(sessionsQuery.data ?? [], period.date), [sessionsQuery.data, period.date]);
  const dayLabel = period.date === period.today ? 'Hôm nay' : `Ngày ${formatShortDate(period.date)}`;
  const monthLabel = historyMonth ? formatMonth(period.month) : 'Tháng này';
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const createSession = useCreateServiceSession();
  const cardsQuery = useListTreatmentCards(undefined, { query: { queryKey: getListTreatmentCardsQueryKey(), enabled: canEdit && canEditCards && quick !== null } });
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
    if (!canDeleteEmployees) return;
    setConfirm({
      title: `Xóa nhân viên ${m.name}?`,
      body: <p>Không thể hoàn tác. Hồ sơ, lịch chấm công, các ca khách lẻ và doanh thu của chúng sẽ bị xóa. Lịch sử dùng thẻ của khách vẫn giữ tên kỹ thuật viên, dịch vụ, ngày, thời lượng và ghi chú; tiền công của các ca này bị xóa và số giờ đã dùng không được hoàn lại. Sổ cá nhân theo tài khoản riêng không bị ảnh hưởng.</p>,
      confirmLabel: 'Xóa nhân viên',
      onConfirm: () => del.mutate({ id: m.id }, { onSuccess: () => { refresh({ members: true }); setConfirm(null); notify(`Đã xóa dữ liệu nhân viên ${m.name}. Lịch sử dùng thẻ vẫn được giữ, số giờ đã dùng không thay đổi.`); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }

  return (
    <section className="panel page" aria-labelledby="emp-title">
      <div className="panel-head wrap">
        <div><h1 id="emp-title" className="page-title">Quản lý nhân viên</h1><p className="sub">{members.length} nhân viên{historyMonth ? ` · ${formatMonth(historyMonth).toLowerCase()}` : ''}</p></div>
        <div className="dialog-actions">
          {canAddEmployees && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }} data-testid="button-add-member"><Plus size={15} />Thêm nhân viên</button>}
        </div>
      </div>
      {membersLoading ? <Skeleton rows={5} label="Đang tải nhân viên" /> : membersError ? <ErrorBanner text="Không tải được danh sách nhân viên." onRetry={retryMembers} /> : list.length === 0 ? (
        <div className="empty"><Users size={22} /><p>{members.length ? 'Không có nhân viên khớp tìm kiếm.' : historyMonth ? `Không có nhân viên nào trong ${formatMonth(historyMonth).toLowerCase()}.` : 'Chưa có nhân viên nào.'}</p>{historyMonth && !members.length && <Link href="/employees" className="btn" data-testid="link-empty-current">Về danh sách hiện tại</Link>}
          {canAddEmployees && !members.length && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }}><Plus size={15} />Thêm nhân viên đầu tiên</button>}</div>
      ) : (
        <>
          {sessionsQuery.isError && <ErrorBanner text="Không tải được tổng lương và ca dịch vụ." onRetry={() => void sessionsQuery.refetch()} />}
          <ul className="emp-list">
            {list.map((m) => {
              const summary = summaries.get(m.id);
              const serviceText = (services: { serviceType: string; visits: number; minutes: number }[]) =>
                services.length ? services.map((service) => `${service.serviceType} · ${service.visits} ca × ${formatMinutes(service.minutes)}`).join('; ') : 'Chưa có ca';
              return (
                <li key={m.id} className="emp-item">
                  <button type="button" className="emp-row as-row" onClick={() => { if (historyMonth) navigate(withHistory(`/employees/${m.id}`)); else setChoice(m); }} aria-haspopup="dialog" data-testid={`button-employee-${m.id}`}>
                    <span className="initials big">{initial(m.name)}</span>
                    <span className="grow">
                      <strong>{m.name}<MemberTags member={m} /></strong>
                      <span className="muted">{historyMonth ? 'Lương, lịch sử ca trong tháng' : 'Chấm công · Chi tiết'}</span>
                      {sessionsQuery.isLoading ? <span className="employee-summary muted">Đang tải lương và ca…</span> : !sessionsQuery.isError && (
                        <span className="employee-summary" data-testid={`summary-employee-${m.id}`}>
                          <span>{monthLabel}: {formatVnd(summary?.monthEarnings ?? 0)} · {summary?.monthSessionCount ?? 0} ca ({serviceText(summary?.monthServices ?? [])})</span>
                          <span>{dayLabel}: {formatVnd(summary?.dayEarnings ?? 0)} · {summary?.daySessionCount ?? 0} ca ({serviceText(summary?.dayServices ?? [])})</span>
                        </span>
                      )}
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  {canDeleteEmployees && <button type="button" className="icon-btn danger" disabled={del.isPending} onClick={() => askDelete(m)} aria-label={`Xóa nhân viên ${m.name}`} data-testid={`button-delete-member-${m.id}`}><Trash2 size={15} /></button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {choice && (
        <Modal title={choice.name} onClose={() => setChoice(null)} testId="dialog-employee-choice">
          <div className="choice-list">
            <button type="button" className="choice-row" disabled={!canEdit} aria-describedby={canEdit ? undefined : 'choice-lock'}
              onClick={() => { if (!canEdit) return; setDialogError(''); setQuickDate(localDate()); setQuick(choice); setChoice(null); }} data-testid="button-choice-attendance">
              <ClipboardCheck size={18} /><span className="grow"><strong>Chấm công</strong><span className="muted">Hôm nay</span></span><ChevronRight size={16} />
            </button>
            <button type="button" className="choice-row" onClick={() => { const id = choice.id; setChoice(null); navigate(withHistory(`/employees/${id}`)); }} data-testid="button-choice-detail">
              <Eye size={18} /><span className="grow"><strong>Xem chi tiết</strong><span className="muted">Lương, lịch sử ca</span></span><ChevronRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {quick && canEdit && (
        <SessionDialog session={null} members={members} allowCards={canEditCards} cards={canEditCards ? cardsQuery.data ?? [] : []} cardsLoading={cardsQuery.isLoading} defaultDate={quickDate} fixedMemberId={quick.id}
          busy={createSession.isPending} serverError={dialogError} onClose={() => setQuick(null)} onSubmit={submitQuick} />
      )}
      {open && canAddEmployees && (
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
