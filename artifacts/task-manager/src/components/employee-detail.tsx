import { useEffect, useMemo, useState } from 'react';
import {
  getGetMemberPayrollQueryKey, getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey,
  useCreateServiceSession, useDeleteMember, useDeleteServiceSession, useGetMemberPayroll, useListServiceSessions,
  useListTreatmentCards, useUpdateMember, useUpdateServiceSession,
} from '@workspace/api-client-react';
import type { ServiceSession, ServiceSessionInput } from '@workspace/api-client-react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { MemberDialog } from '@/components/entity-dialogs';
import { ConfirmDialog, ErrorBanner, Skeleton, type ConfirmState } from '@/components/modal';
import { DatePickerDialog } from '@/components/date-picker-dialog';
import { SessionDialog } from '@/components/session-dialog';
import { SessionTable } from '@/components/session-table';
import { formatDate, formatShortDate, localDate } from '@/lib/attendance';
import { SESSION_FRESHNESS, errorText, formatMinutes, formatMonth, formatVnd, monthOf, shiftMonth, useRefreshMassage } from '@/lib/massage';

export function EmployeeDetail({ memberId, readOnly, initialDate }: { memberId: number | null; readOnly: boolean; initialDate?: string | null }) {
  const shell = useShell();
  const { members, membersLoading, membersError, retryMembers, notify, fail } = shell;
  const canEdit = shell.canEdit && !readOnly;
  const [, navigate] = useLocation();
  const today = localDate();
  const validInitial = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null;
  const [month, setMonth] = useState(monthOf(validInitial ?? today));
  const [day, setDay] = useState(validInitial ?? today);
  const [sessionDialog, setSessionDialog] = useState<{ session: ServiceSession | null } | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [memberDialog, setMemberDialog] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => { setEditing(false); }, [day, month, memberId, canEdit]);

  const member = memberId !== null ? members.find((m) => m.id === memberId) ?? null : null;
  const id = member?.id ?? 0;
  const payrollParams = useMemo(() => ({ memberId: id, month }), [id, month]);
  const payroll = useGetMemberPayroll(payrollParams, { query: { queryKey: getGetMemberPayrollQueryKey(payrollParams), enabled: id > 0, ...SESSION_FRESHNESS } });
  const sessionParams = useMemo(() => ({ memberId: id, month }), [id, month]);
  const sessionsQuery = useListServiceSessions(sessionParams, { query: { queryKey: getListServiceSessionsQueryKey(sessionParams), enabled: id > 0, ...SESSION_FRESHNESS } });
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), enabled: canEdit && sessionDialog !== null } });

  const createSession = useCreateServiceSession();
  const updateSession = useUpdateServiceSession();
  const deleteSession = useDeleteServiceSession();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const refresh = useRefreshMassage();

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const daySessions = useMemo(() => sessions.filter((s) => s.workDate === day), [sessions, day]);
  const dayTypes = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of daySessions) map.set(s.serviceType || 'Không tên', (map.get(s.serviceType || 'Không tên') ?? 0) + 1);
    return [...map.entries()];
  }, [daySessions]);
  const dayEarnings = daySessions.reduce((a, s) => a + s.earnings, 0);

  function changeMonth(next: string) {
    setMonth(next);
    setDay(next === monthOf(today) ? today : `${next}-01`);
  }
  function chooseDay(next: string) {
    setMonth(monthOf(next));
    setDay(next);
    setDatePickerOpen(false);
  }

  function submitSession(input: ServiceSessionInput) {
    if (!canEdit || !sessionDialog) return;
    setDialogError('');
    const opts = {
      onSuccess: () => { refresh(); setSessionDialog(null); notify(sessionDialog.session ? 'Đã cập nhật ca phục vụ.' : 'Đã ghi ca phục vụ.'); },
      onError: (e: unknown) => { setDialogError(errorText(e)); fail(e); },
    };
    if (sessionDialog.session) updateSession.mutate({ id: sessionDialog.session.id, data: input }, opts);
    else createSession.mutate({ data: input }, opts);
  }
  function askDeleteSession(s: ServiceSession) {
    if (!canEdit) return;
    setConfirm({
      title: 'Xóa ca phục vụ?',
      body: <p>Xóa ca {formatMinutes(s.minutes)} ngày {formatShortDate(s.workDate)} của {s.employeeName}. Lương ca {formatVnd(s.earnings)} sẽ bị trừ khỏi bảng lương{s.cardId !== null ? `, và ${formatMinutes(s.minutes)} được hoàn lại vào thẻ #${s.cardId}` : ''}. Không thể hoàn tác.</p>,
      confirmLabel: 'Xóa ca',
      onConfirm: () => deleteSession.mutate({ id: s.id }, { onSuccess: () => { refresh(); setConfirm(null); notify('Đã xóa ca phục vụ.'); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }
  function askDeleteMember() {
    if (!canEdit || !member) return;
    setConfirm({
      title: `Xóa nhân viên ${member.name}?`,
      body: <p>Nhân viên sẽ bị gỡ khỏi danh sách. Toàn bộ ca phục vụ, lương đã lưu và chấm công cũ của {member.name} vẫn được giữ trong dữ liệu và hiển thị là “đã xóa”. Không thể hoàn tác.</p>,
      confirmLabel: 'Xóa nhân viên',
      onConfirm: () => deleteMember.mutate({ id: member.id }, { onSuccess: () => { refresh({ members: true }); setConfirm(null); notify(`Đã xóa ${member.name}. Lịch sử phục vụ vẫn được giữ.`); navigate('/employees'); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }

  const back = readOnly
    ? <button type="button" className="back as-button" onClick={() => { shell.setView({ mode: 'owner', employeeId: shell.prefs.employeeId }); navigate('/employees'); }} data-testid="link-back"><ArrowLeft size={15} />Trở về</button>
    : null;

  if (memberId === null) {
    return <section className="panel page">{back}<div className="empty"><UserX size={22} /><p>Chưa chọn nhân viên để xem.</p><button type="button" className="btn primary" onClick={shell.openSettings} data-testid="button-choose-employee">Chọn nhân viên</button></div></section>;
  }
  if (membersLoading) return <section className="panel page">{back}<Skeleton rows={6} label="Đang tải nhân viên" /></section>;
  if (membersError) return <section className="panel page">{back}<ErrorBanner text="Không tải được thông tin nhân viên." onRetry={retryMembers} /></section>;
  if (!member) {
    return <section className="panel page">{back}<div className="empty"><UserX size={22} /><p>Nhân viên này không tồn tại hoặc đã bị xóa.</p>{readOnly ? <button type="button" className="btn" onClick={shell.openSettings}>Chọn nhân viên khác</button> : <Link href="/employees" className="btn">Về danh sách</Link>}</div></section>;
  }

  const p = payroll.data;
  const selectedDayPanel = (
    <section className="panel" aria-labelledby="day-title" data-testid="section-day-sessions">
      <div className="panel-head wrap">
        <div><h2 id="day-title" className="day-title"><CalendarDays size={16} aria-hidden="true" />{formatDate(day)}</h2>
          <p className="sub">{daySessions.length} ca · {formatMinutes(daySessions.reduce((a, s) => a + s.minutes, 0))} · {formatVnd(dayEarnings)}</p></div>
      </div>
      {sessionsQuery.isLoading ? <Skeleton rows={3} label="Đang tải ca phục vụ" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được ca phục vụ." onRetry={() => void sessionsQuery.refetch()} /> : daySessions.length === 0 ? (
        <div className="empty small"><CalendarDays size={18} /><p>Chưa có ca được ghi trong ngày này.</p></div>
      ) : (
          <SessionTable sessions={daySessions} caption={`Ca phục vụ ngày ${formatShortDate(day)}`} canEdit={canEdit && editing} visibleActions linkCards={canEdit} busy={deleteSession.isPending}
          onEdit={(s) => { setDialogError(''); setSessionDialog({ session: s }); }} onDelete={askDeleteSession} testId="day-sessions" />
      )}
      {canEdit && (
        <div className="day-actions" data-testid="day-actions">
          <button type="button" className={`btn small ${editing ? 'primary' : ''}`} aria-pressed={editing} disabled={daySessions.length === 0 || sessionsQuery.isLoading}
            aria-describedby={daySessions.length === 0 ? 'day-edit-hint' : undefined} onClick={() => setEditing((v) => !v)} data-testid="button-toggle-edit-day">
            <Pencil size={14} />{editing ? 'Xong chỉnh sửa' : 'Chỉnh sửa'}
          </button>
          {daySessions.length === 0 && <span id="day-edit-hint" className="hint">Chưa có ca để chỉnh sửa trong ngày này.</span>}
          {editing && daySessions.length > 0 && <span className="hint">Chọn Sửa ca hoặc Xóa ca ở danh sách.</span>}
          <button type="button" className="btn small" onClick={() => { setDialogError(''); setSessionDialog({ session: null }); }} data-testid="button-add-session"><Plus size={14} />Chấm công</button>
        </div>
      )}
    </section>
  );
  return (
    <div className="detail">
      {readOnly && <div className="detail-top">{back}</div>}
      <section className="salary-hero compact" aria-labelledby="salary-title" data-testid="section-salary">
        <div className="month-nav">
          <button type="button" className="icon-btn" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Tháng trước" data-testid="button-prev-month"><ChevronLeft size={16} /></button>
          <h1 id="salary-title" className="salary-label">Tổng lương {formatMonth(month).toLowerCase()} · <span data-testid="text-member-name">{member.name}</span></h1>
          <button type="button" className="icon-btn" onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Tháng sau" data-testid="button-next-month"><ChevronRight size={16} /></button>
          {month !== monthOf(today) && <button type="button" className="link-soft as-button" onClick={() => changeMonth(monthOf(today))}>Tháng này</button>}
        </div>
        {payroll.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải lương" /> : payroll.isError ? <ErrorBanner text="Không tải được lương." onRetry={() => void payroll.refetch()} /> : (
          <p className="rev-value mono" data-testid="text-total-salary">{formatVnd(p?.totalSalary ?? 0)}</p>
        )}
      </section>
      <section className="day-salary" aria-labelledby="day-salary-title" data-testid="section-day-salary">
        <div className="day-salary-heading">
          <h2 id="day-salary-title" className="rev-label">Tổng lương ngày · {formatShortDate(day)}</h2>
          <button type="button" className="btn small date-picker-trigger" onClick={() => setDatePickerOpen(true)} aria-label={`Chọn ngày xem chi tiết, hiện tại ${formatShortDate(day)}`} data-testid="button-open-detail-date-picker">
            <CalendarDays size={14} aria-hidden="true" />{formatShortDate(day)}
          </button>
        </div>
        {sessionsQuery.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải lương ngày" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được ca phục vụ." onRetry={() => void sessionsQuery.refetch()} /> : (
          <>
            <p className="day-salary-value mono" data-testid="text-day-salary">{formatVnd(dayEarnings)}</p>
            {dayTypes.length > 0 ? (
              <ul className="type-counts" aria-label="Số ca theo dịch vụ">{dayTypes.map(([name, n]) => <li key={name}>{name} <strong className="mono">{n} ca</strong></li>)}</ul>
            ) : <p className="muted small">Chưa có ca.</p>}
          </>
        )}
      </section>

      {selectedDayPanel}

      {canEdit && (
        <div className="employee-management-actions" aria-label={`Thao tác với nhân viên ${member.name}`}>
          <button type="button" className="btn" onClick={() => { setDialogError(''); setMemberDialog(true); }} data-testid="button-edit-member"><Pencil size={14} />Sửa tên nhân viên</button>
          <button type="button" className="btn danger" onClick={askDeleteMember} data-testid="button-delete-member"><Trash2 size={14} />Xóa nhân viên</button>
        </div>
      )}

      {datePickerOpen && <DatePickerDialog value={day} title="Chọn ngày xem chi tiết" onClose={() => setDatePickerOpen(false)} onSelect={chooseDay} />}
      {sessionDialog && canEdit && (
        <SessionDialog session={sessionDialog.session} members={members} cards={cardsQuery.data ?? []} cardsLoading={cardsQuery.isLoading} defaultDate={day} defaultMemberId={member.id} fixedMemberId={sessionDialog.session ? undefined : member.id}
          busy={createSession.isPending || updateSession.isPending} serverError={dialogError} onClose={() => setSessionDialog(null)} onSubmit={submitSession} />
      )}
      {memberDialog && canEdit && (
        <MemberDialog member={member} busy={updateMember.isPending} serverError={dialogError} onClose={() => setMemberDialog(false)}
          onSubmit={({ name }) => updateMember.mutate({ id: member.id, data: { name } }, {
            onSuccess: () => { refresh({ members: true }); setMemberDialog(false); notify('Đã cập nhật tên nhân viên.'); },
            onError: (e) => { setDialogError(errorText(e)); fail(e); },
          })} />
      )}
      {confirm && <ConfirmDialog state={confirm} busy={deleteSession.isPending || deleteMember.isPending} onClose={() => setConfirm(null)} />}
    </div>
  );
}
