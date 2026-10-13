import { useMemo, useState } from 'react';
import {
  getGetMemberPayrollQueryKey, getListAttendanceQueryKey, getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey,
  useCreateServiceSession, useDeleteMember, useDeleteServiceSession, useGetMemberPayroll, useListAttendance, useListServiceSessions,
  useListTreatmentCards, useUpdateMember, useUpdateServiceSession,
} from '@workspace/api-client-react';
import type { ServiceSession, ServiceSessionInput } from '@workspace/api-client-react';
import { ArrowLeft, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, History, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { MemberDialog } from '@/components/entity-dialogs';
import { ConfirmDialog, ErrorBanner, Skeleton, type ConfirmState } from '@/components/modal';
import { SessionDialog } from '@/components/session-dialog';
import { SessionTable } from '@/components/session-table';
import { formatDate, formatShortDate, initial, localDate, normalize, statusLabel } from '@/lib/attendance';
import { SESSION_FRESHNESS, daysInMonth, errorText, formatMinutes, formatMonth, formatVnd, monthOf, shiftMonth, useRefreshMassage, weekday } from '@/lib/massage';

export function EmployeeDetail({ memberId, readOnly, initialDate }: { memberId: number | null; readOnly: boolean; initialDate?: string | null }) {
  const shell = useShell();
  const { members, membersLoading, membersError, retryMembers, query, notify, fail } = shell;
  const canEdit = shell.canEdit && !readOnly;
  const [, navigate] = useLocation();
  const today = localDate();
  const validInitial = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null;
  const [month, setMonth] = useState(monthOf(validInitial ?? today));
  const [day, setDay] = useState(validInitial ?? today);
  const [sessionDialog, setSessionDialog] = useState<{ session: ServiceSession | null } | null>(null);
  const [memberDialog, setMemberDialog] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dialogError, setDialogError] = useState('');

  const member = memberId !== null ? members.find((m) => m.id === memberId) ?? null : null;
  const id = member?.id ?? 0;
  const payrollParams = useMemo(() => ({ memberId: id, month }), [id, month]);
  const payroll = useGetMemberPayroll(payrollParams, { query: { queryKey: getGetMemberPayrollQueryKey(payrollParams), enabled: id > 0, refetchOnWindowFocus: true } });
  const sessionParams = useMemo(() => ({ memberId: id, month }), [id, month]);
  const sessionsQuery = useListServiceSessions(sessionParams, { query: { queryKey: getListServiceSessionsQueryKey(sessionParams), enabled: id > 0, ...SESSION_FRESHNESS } });
  const attParams = useMemo(() => ({ memberId: id, date: day }), [id, day]);
  const attendance = useListAttendance(attParams, { query: { queryKey: getListAttendanceQueryKey(attParams), enabled: id > 0 } });
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), enabled: canEdit && sessionDialog !== null } });

  const createSession = useCreateServiceSession();
  const updateSession = useUpdateServiceSession();
  const deleteSession = useDeleteServiceSession();
  const updateMember = useUpdateMember();
  const deleteMember = useDeleteMember();
  const refresh = useRefreshMassage();

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const perDay = useMemo(() => {
    const map = new Map<string, { count: number; minutes: number }>();
    for (const s of sessions) { const v = map.get(s.workDate) ?? { count: 0, minutes: 0 }; v.count += 1; v.minutes += s.minutes; map.set(s.workDate, v); }
    return map;
  }, [sessions]);
  const days = useMemo(() => {
    const n = daysInMonth(month);
    const all = Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
    if (month !== monthOf(today)) return all;
    const past = all.filter((d) => d < today).reverse();
    const future = all.filter((d) => d > today);
    return [today, ...past, ...future];
  }, [month, today]);
  const daySessions = useMemo(() => sessions.filter((s) => s.workDate === day), [sessions, day]);
  const q = normalize(query);
  const searchHits = useMemo(() => (q ? sessions.filter((s) => normalize([s.customerName, s.serviceType, s.note, formatShortDate(s.workDate)].join(' ')).includes(q)) : []), [sessions, q]);

  function changeMonth(next: string) {
    setMonth(next);
    setDay(next === monthOf(today) ? today : `${next}-01`);
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

  const back = readOnly ? null : <Link href="/employees" className="back" data-testid="link-back"><ArrowLeft size={15} />Danh sách nhân viên</Link>;

  if (memberId === null) {
    return <section className="panel page"><div className="empty"><UserX size={22} /><p>Chưa chọn nhân viên để xem.</p><button type="button" className="btn primary" onClick={shell.openSettings} data-testid="button-choose-employee">Chọn nhân viên</button></div></section>;
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
          <p className="sub">{daySessions.length} ca · {formatMinutes(daySessions.reduce((a, s) => a + s.minutes, 0))} · {formatVnd(daySessions.reduce((a, s) => a + s.earnings, 0))}</p></div>
        {canEdit && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setSessionDialog({ session: null }); }} data-testid="button-add-session"><Plus size={15} />Chấm công</button>}
      </div>
      {sessionsQuery.isLoading ? <Skeleton rows={3} label="Đang tải ca phục vụ" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được ca phục vụ." onRetry={() => void sessionsQuery.refetch()} /> : daySessions.length === 0 ? (
        <div className="empty small"><CalendarDays size={18} /><p>Chưa có ca được ghi trong ngày này.</p></div>
      ) : (
        <SessionTable sessions={daySessions} caption={`Ca phục vụ ngày ${formatShortDate(day)}`} canEdit={canEdit} linkCards={!readOnly} busy={deleteSession.isPending}
          onEdit={(s) => { setDialogError(''); setSessionDialog({ session: s }); }} onDelete={askDeleteSession} testId="day-sessions" />
      )}
      {(attendance.data?.length ?? 0) > 0 && (
        <div className="legacy" data-testid="section-legacy-attendance">
          <h3><History size={14} />Chấm công cũ — không tính vào lương phục vụ</h3>
          <ul>{attendance.data!.map((r) => <li key={r.id} className="muted">{statusLabel(r.status)}{r.checkIn ? ` · vào ${r.checkIn}` : ''}{r.checkOut ? ` · ra ${r.checkOut}` : ''}{r.note ? ` · ${r.note}` : ''}</li>)}</ul>
        </div>
      )}
    </section>
  );
  return (
    <div className="detail">
      {back}
      <section className="salary-hero" aria-labelledby="salary-title" data-testid="section-salary">
        <div className="hero-top">
          <span className="initials big">{initial(member.name)}</span>
          <div className="grow"><h1 className="page-title" data-testid="text-member-name">{member.name}</h1>
            <p className="sub">Lương tính theo dịch vụ · giờ phục vụ × giá trả công từng dịch vụ</p>
          </div>
          {canEdit && (
            <div className="head-actions">
              <button type="button" className="btn" onClick={() => { setDialogError(''); setMemberDialog(true); }} data-testid="button-edit-member"><Pencil size={14} />Sửa tên</button>
              <button type="button" className="icon-btn danger" onClick={askDeleteMember} aria-label={`Xóa nhân viên ${member.name}`} data-testid="button-delete-member"><Trash2 size={15} /></button>
            </div>
          )}
        </div>
        <div className="month-nav">
          <button type="button" className="icon-btn" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label="Tháng trước" data-testid="button-prev-month"><ChevronLeft size={16} /></button>
          <span id="salary-title">Tổng lương {formatMonth(month).toLowerCase()}</span>
          <button type="button" className="icon-btn" onClick={() => changeMonth(shiftMonth(month, 1))} aria-label="Tháng sau" data-testid="button-next-month"><ChevronRight size={16} /></button>
          {month !== monthOf(today) && <button type="button" className="link-soft as-button" onClick={() => changeMonth(monthOf(today))}>Tháng này</button>}
        </div>
        {payroll.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải lương" /> : payroll.isError ? <ErrorBanner text="Không tải được lương." onRetry={() => void payroll.refetch()} /> : (
          <>
            <p className="rev-value mono" data-testid="text-total-salary">{formatVnd(p?.totalSalary ?? 0)}</p>
            <p className="sub" data-testid="text-total-minutes">{formatMinutes(p?.totalMinutes ?? 0)} phục vụ khách · theo mức lương lưu tại từng ca</p>
          </>
        )}
      </section>

      {q && (
        <section className="panel" aria-labelledby="emp-search">
          <div className="panel-head"><h2 id="emp-search">Kết quả “{query.trim()}” trong {formatMonth(month).toLowerCase()}</h2></div>
          {searchHits.length === 0 ? <p className="muted small">Không có ca khớp.</p> : (
            <SessionTable sessions={searchHits} caption="Ca phục vụ khớp tìm kiếm" canEdit={false} showDate onEdit={() => undefined} onDelete={() => undefined} testId="employee-search" />
          )}
        </section>
      )}

      <ul className="day-list" aria-label={`Các ngày ${formatMonth(month)}`} data-testid="list-days">
        {days.map((d) => {
          const info = perDay.get(d);
          return (
            <li key={d} className="day-item">
              <button id={`day-toggle-${d}`} type="button" aria-expanded={d === day} aria-controls={`day-panel-${d}`}
                className={`day-row ${d === day ? 'active' : ''} ${d === today ? 'today' : ''}`}
                onClick={() => setDay(d)} data-testid={`button-day-${d}`}>
                <span className="day-row-date"><strong className="mono">{formatShortDate(d)}</strong><span className="muted">{d === today ? 'Hôm nay' : weekday(d)}</span></span>
                <span className="day-row-summary">{sessionsQuery.isLoading ? 'Đang tải…' : sessionsQuery.isError ? 'Chưa tải được ca' : info ? `${info.count} ca · ${formatMinutes(info.minutes)}` : 'Chưa có ca'}</span>
                <ChevronDown size={17} className="day-chevron" aria-hidden="true" />
              </button>
              <div id={`day-panel-${d}`} className="day-detail" hidden={d !== day}>
                {d === day && selectedDayPanel}
              </div>
            </li>
          );
        })}
      </ul>

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
