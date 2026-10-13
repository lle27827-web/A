import { useMemo, useState } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAttendanceSummaryQueryKey,
  getGetCurrentAccessQueryKey,
  getListAttendanceQueryKey,
  getListMembersQueryKey,
  useCreateAttendance,
  useCreateMember,
  useDeleteAttendance,
  useDeleteMember,
  useGetAttendanceSummary,
  useGetCurrentAccess,
  useListAttendance,
  useListMembers,
  useUpdateAttendance,
} from '@workspace/api-client-react';
import type { AttendanceInput, AttendanceRecord, AttendanceStatus, ListAttendanceParams, MemberInput, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, ArrowUpRight, CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Eye, LoaderCircle, LockKeyhole, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { Link } from 'wouter';
import { AttendanceTable, TableSkeleton } from '@/components/attendance-table';
import { AttendanceDialog } from '@/components/attendance-dialog';
import { MemberHistory, MemberList } from '@/components/member-panel';
import { ViewSettings, useViewPrefs, type ViewPrefs } from '@/components/view-settings';
import { EmployeeView } from '@/components/employee-view';
import { STATUS_OPTIONS, formatDate, formatShortDate, initial, localDate, messageFromError, normalize, recordMatches, statusCode } from '@/lib/attendance';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AttendanceApp() {
  const cache = useQueryClient();
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(localDate());
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('');
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ record: AttendanceRecord | null; memberId?: number | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [operationError, setOperationError] = useState('');

  const searching = query.trim().length > 0;
  const accessQuery = useGetCurrentAccess({ query: { queryKey: getGetCurrentAccessQueryKey(), retry: false } });
  const access = accessQuery.data;
  const isOwner = access?.isOwner === true;
  const [prefs, setPrefs] = useViewPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const employeeMode = prefs.mode === 'employee';
  // Effective permission: display mode can only remove rights, never grant them.
  const canEdit = isOwner && prefs.mode === 'owner';

  const membersQuery = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  const dayParams = useMemo<ListAttendanceParams>(() => (statusFilter ? { date, status: statusFilter } : { date }), [date, statusFilter]);
  const dayQuery = useListAttendance(dayParams, { query: { queryKey: getListAttendanceQueryKey(dayParams), enabled: !searching && !employeeMode } });
  const summaryParams = useMemo(() => ({ date }), [date]);
  const summaryQuery = useGetAttendanceSummary(summaryParams, { query: { queryKey: getGetAttendanceSummaryQueryKey(summaryParams), enabled: !searching && !employeeMode } });

  // Full history across all dates: used for combined search.
  const allQuery = useListAttendance(undefined, { query: { queryKey: getListAttendanceQueryKey(), enabled: searching && !employeeMode } });
  const historyParams = useMemo<ListAttendanceParams | undefined>(() => (selectedMemberId === null ? undefined : { memberId: selectedMemberId }), [selectedMemberId]);
  const historyQuery = useListAttendance(historyParams, { query: { queryKey: getListAttendanceQueryKey(historyParams), enabled: selectedMemberId !== null && !employeeMode } });
  const membersReady = membersQuery.isSuccess;
  const viewedEmployee = employeeMode && prefs.employeeId !== null ? members.find((m) => m.id === prefs.employeeId) ?? null : null;
  const employeeParams = useMemo<ListAttendanceParams>(() => ({ memberId: viewedEmployee?.id ?? -1 }), [viewedEmployee?.id]);
  const employeeQuery = useListAttendance(employeeParams, { query: { queryKey: getListAttendanceQueryKey(employeeParams), enabled: viewedEmployee !== null } });

  function applyView(next: ViewPrefs) {
    if (next.mode !== prefs.mode || next.employeeId !== prefs.employeeId) {
      setDialog(null);
      setOperationError('');
      setNotice('');
    }
    setPrefs(next);
  }

  const createMember = useCreateMember();
  const deleteMember = useDeleteMember();
  const createRecord = useCreateAttendance();
  const updateRecord = useUpdateAttendance();
  const deleteRecord = useDeleteAttendance();

  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null;
  const memberMatches = useMemo(() => members.filter((m) => normalize(m.name).includes(normalize(query))), [members, query]);
  const shiftMatches = useMemo(() => {
    if (!searching) return [];
    return (allQuery.data ?? []).filter((r) => recordMatches(r, query) && (!statusFilter || r.status === statusFilter)).sort((a, b) => b.workDate.localeCompare(a.workDate));
  }, [allQuery.data, query, searching, statusFilter]);

  function invalidateAttendance() {
    void cache.invalidateQueries({ queryKey: getListAttendanceQueryKey() });
    void cache.invalidateQueries({ queryKey: getGetAttendanceSummaryQueryKey() });
  }
  function handleError(error: unknown) {
    setNotice('');
    setOperationError(messageFromError(error));
    if (statusCode(error) === 401 || statusCode(error) === 403) {
      cache.setQueryData(getGetCurrentAccessQueryKey(), { signedIn: access?.signedIn ?? false, isOwner: false, canManage: false, ownerConfigured: access?.ownerConfigured ?? false });
      void cache.invalidateQueries({ queryKey: getGetCurrentAccessQueryKey() });
    }
  }
  function success(message: string) { setOperationError(''); setNotice(message); }

  function addMember(input: MemberInput, done: () => void) {
    if (!canEdit) return;
    createMember.mutate({ data: input }, {
      onSuccess: (member) => { void cache.invalidateQueries({ queryKey: getListMembersQueryKey() }); done(); success(`Đã thêm Nhân viên ${member.name}.`); },
      onError: handleError,
    });
  }
  function removeMember(member: MemberRecord) {
    if (!canEdit) return;
    if (!window.confirm(`Xóa Nhân viên “${member.name}”?\n\nLịch sử chấm công trước đây của ${member.name} vẫn được giữ nguyên và vẫn tìm kiếm được. Thao tác xóa Nhân viên không thể hoàn tác.`)) return;
    deleteMember.mutate({ id: member.id }, {
      onSuccess: () => {
        void cache.invalidateQueries({ queryKey: getListMembersQueryKey() });
        invalidateAttendance();
        if (selectedMemberId === member.id) setSelectedMemberId(null);
        success(`Đã xóa ${member.name}. Lịch sử ca vẫn được giữ.`);
      },
      onError: handleError,
    });
  }
  function submitRecord(input: AttendanceInput) {
    if (!canEdit || !dialog) return;
    setOperationError('');
    const opts = { onSuccess: () => { invalidateAttendance(); success(dialog.record ? 'Đã cập nhật ca làm.' : 'Đã ghi nhận ca làm.'); setDialog(null); }, onError: handleError };
    if (dialog.record) updateRecord.mutate({
      id: dialog.record.id,
      data: dialog.record.memberId === null && input.memberId === 0
        ? { ...input, memberId: null, employeeName: dialog.record.employeeName }
        : input,
    }, opts);
    else createRecord.mutate({ data: input }, opts);
  }
  function removeRecord(record: AttendanceRecord) {
    if (!canEdit) return;
    if (!window.confirm(`Xóa ca của ${record.employeeName} ngày ${formatShortDate(record.workDate)}? Thao tác này không thể hoàn tác.`)) return;
    deleteRecord.mutate({ id: record.id }, { onSuccess: () => { invalidateAttendance(); success('Đã xóa ca làm.'); }, onError: handleError });
  }
  const openEdit = (record: AttendanceRecord) => { setOperationError(''); setDialog({ record }); };
  const summary = summaryQuery.data;
  const dayRecords = dayQuery.data ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" data-testid="link-home"><span className="brand-mark"><CheckCheck size={16} strokeWidth={2.6} /></span><span>SỔ CÔNG</span></Link>
          <form role="search" className="search" onSubmit={(e) => e.preventDefault()}>
            <Search size={16} aria-hidden="true" />
            <label htmlFor="global-search" className="sr-only">Tìm Nhân viên và ca làm</label>
            <input id="global-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={employeeMode ? (viewedEmployee ? `Tìm trong ca của ${viewedEmployee.name}...` : 'Chọn Nhân viên để tìm...') : 'Tìm Nhân viên, ngày, giờ hoặc ghi chú ca...'} disabled={employeeMode && !viewedEmployee} autoComplete="off" data-testid="input-global-search" />
            {searching && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm" data-testid="button-clear-search"><X size={15} /></button>}
          </form>
          <div className="account">
            <span className="mode-pill" data-testid="status-view-mode">{employeeMode ? 'Nhân viên' : 'Chủ'}</span>
            <span className={`access ${isOwner ? 'owner' : ''}`} data-testid="status-access">
              {accessQuery.isLoading ? <LoaderCircle className="spin" size={13} /> : isOwner ? <ShieldCheck size={14} /> : <Eye size={14} />}
              <span className="access-text">{accessQuery.isLoading ? 'Đang kiểm tra' : isOwner ? 'Chủ sở hữu' : 'Chỉ xem'}</span>
            </span>
            {access?.signedIn ? <SignOutButton /> : (
              <>
                <Link href="/sign-in" className="link-strong" data-testid="link-owner-signin">Đăng nhập <ArrowUpRight size={13} /></Link>
                {access?.ownerConfigured && <Link href="/sign-up" className="link-soft" data-testid="link-owner-signup">Tạo tài khoản</Link>}
              </>
            )}
            <ViewSettings isOwner={false} canEdit={false} onAuthError={() => undefined} prefs={prefs} members={members} membersLoading={membersQuery.isLoading} open={settingsOpen} onOpenChange={setSettingsOpen} onApply={applyView} />
          </div>
        </div>
      </header>

      <main className="main" id="main">
        {!accessQuery.isLoading && access?.ownerConfigured === false && (
          <div className="banner soft" role="status" data-testid="status-owner-setup"><LockKeyhole size={15} /><span>Chưa cấu hình chủ sở hữu. Đặt OWNER_EMAIL bằng email đã xác minh trên Clerk; mọi thay đổi đang bị khóa.</span></div>
        )}
        {!accessQuery.isLoading && accessQuery.isError && statusCode(accessQuery.error) !== 401 && statusCode(accessQuery.error) !== 403 && (
          <div className="banner danger" role="alert"><AlertCircle size={15} /><span>Không thể xác minh quyền. Thao tác chỉnh sửa đang được khóa.</span><button type="button" onClick={() => void accessQuery.refetch()}>Thử lại</button></div>
        )}
        {operationError && <div className="banner danger" role="alert" data-testid="status-mutation-error"><AlertCircle size={15} /><span>{operationError}</span><button type="button" onClick={() => setOperationError('')} aria-label="Đóng thông báo lỗi"><X size={14} /></button></div>}
        {notice && <div className="banner success" role="status" data-testid="status-success"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={14} /></button></div>}

        {!employeeMode && !canEdit && !accessQuery.isLoading && (
          <div className="banner soft" role="status" data-testid="status-readonly-owner"><Eye size={15} /><span>{isOwner ? 'Đang xem.' : 'Chế độ Chủ ở dạng chỉ xem. Đăng nhập bằng tài khoản chủ sở hữu để chỉnh sửa.'}</span>{!access?.signedIn && <Link href="/sign-in" className="link-strong">Đăng nhập <ArrowUpRight size={13} /></Link>}</div>
        )}
        {employeeMode ? (
          <EmployeeView employeeId={prefs.employeeId} employee={viewedEmployee} membersLoading={membersQuery.isLoading} membersError={membersQuery.isError} membersReady={membersReady}
            records={employeeQuery.data ?? []} loading={employeeQuery.isLoading} error={employeeQuery.isError} query={query}
            onRetryMembers={() => void membersQuery.refetch()} onRetry={() => void employeeQuery.refetch()} onChoose={() => setSettingsOpen(true)} onClearQuery={() => setQuery('')} />
        ) : (
        <div className="layout">
          <aside className="side">
            <MemberList members={members} selectedId={selectedMemberId} isOwner={canEdit} loading={membersQuery.isLoading} error={membersQuery.isError} busy={createMember.isPending || deleteMember.isPending}
              onRetry={() => void membersQuery.refetch()} onSelect={setSelectedMemberId} onCreate={addMember} onDelete={removeMember} />
          </aside>

          <div className="content">
            {selectedMember && (
              <MemberHistory member={selectedMember} records={historyQuery.data ?? []} loading={historyQuery.isLoading} error={historyQuery.isError} isOwner={canEdit} busy={deleteRecord.isPending}
                onRetry={() => void historyQuery.refetch()} onClose={() => setSelectedMemberId(null)} onEdit={openEdit} onDelete={removeRecord}
                onAdd={() => { setOperationError(''); setDialog({ record: null, memberId: selectedMember.id }); }} />
            )}

            {searching ? (
              <section className="panel" aria-labelledby="search-title" data-testid="section-search-results">
                <div className="panel-head">
                  <div>
                    <h2 id="search-title">Kết quả cho “{query.trim()}”</h2>
                    <p className="sub" aria-live="polite" data-testid="text-search-count">{allQuery.isLoading ? 'Đang tìm trên mọi ngày…' : `${memberMatches.length} Nhân viên · ${shiftMatches.length} ca trên mọi ngày`}</p>
                  </div>
                  <StatusSelect value={statusFilter} onChange={setStatusFilter} />
                </div>
                {memberMatches.length > 0 && (
                  <div className="chip-row" aria-label="Nhân viên phù hợp">
                    {memberMatches.map((m) => <button type="button" key={m.id} className={`chip ${selectedMemberId === m.id ? 'active' : ''}`} onClick={() => setSelectedMemberId(m.id)} aria-pressed={selectedMemberId === m.id} data-testid={`button-search-member-${m.id}`}><span className="initials tiny" aria-hidden="true">{initial(m.name)}</span>{m.name}</button>)}
                  </div>
                )}
                {allQuery.isLoading ? <TableSkeleton label="Đang tìm ca làm" /> : allQuery.isError ? (
                  <div className="banner danger" role="alert"><AlertCircle size={15} /><span>Không tải được dữ liệu ca để tìm kiếm.</span><button type="button" onClick={() => void allQuery.refetch()}>Thử lại</button></div>
                ) : shiftMatches.length === 0 ? (
                  <div className="empty" data-testid="status-empty-search"><Search size={20} /><p>Không có ca làm nào khớp{statusFilter ? ' với tình trạng đã chọn' : ''}.</p><button type="button" className="btn" onClick={() => setQuery('')}>Xóa tìm kiếm</button></div>
                ) : (
                  <AttendanceTable records={shiftMatches} caption="Ca làm khớp từ khóa trên mọi ngày, mới nhất trước" isOwner={canEdit} showDate busy={deleteRecord.isPending} onEdit={openEdit} onDelete={removeRecord} testId="search-shifts" />
                )}
              </section>
            ) : (
              <section className="panel" aria-labelledby="day-title" data-testid="section-day">
                <div className="panel-head wrap">
                  <div className="date-nav">
                    <button type="button" className="icon-btn" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Ngày trước" data-testid="button-prev-day"><ChevronLeft size={16} /></button>
                    <label htmlFor="attendance-date" className="sr-only">Chọn ngày</label>
                    <input id="attendance-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="input-attendance-date" />
                    <button type="button" className="icon-btn" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Ngày sau" data-testid="button-next-day"><ChevronRight size={16} /></button>
                    {date !== localDate() && <button type="button" className="link-soft as-button" onClick={() => setDate(localDate())} data-testid="button-today">Hôm nay</button>}
                  </div>
                  <div className="head-actions">
                    <StatusSelect value={statusFilter} onChange={setStatusFilter} />
                    {canEdit ? (
                      <button type="button" className="btn primary" onClick={() => { setOperationError(''); setDialog({ record: null }); }} data-testid="button-add-attendance"><Plus size={15} />Ghi nhận ca</button>
                    ) : <span className="view-only" data-testid="text-view-only"><LockKeyhole size={13} />Chỉ xem</span>}
                  </div>
                </div>
                <h2 id="day-title" className="day-title"><CalendarDays size={16} aria-hidden="true" />{formatDate(date)}</h2>

                {summaryQuery.isLoading ? <div className="stats skeleton" role="status" aria-label="Đang tải tổng quan"><span /><span /><span /><span /></div> : summaryQuery.isError ? (
                  <div className="banner danger" role="alert" data-testid="status-attendance-summary-error"><AlertCircle size={15} /><span>Không tải được tổng quan.</span><button type="button" onClick={() => void summaryQuery.refetch()}>Thử lại</button></div>
                ) : (
                  <dl className="stats" data-testid="summary-attendance">
                    <Stat label="Tổng ca" value={summary?.total ?? 0} tone="total" />
                    <Stat label="Có mặt" value={summary?.present ?? 0} tone="present" />
                    <Stat label="Đi muộn" value={summary?.late ?? 0} tone="late" />
                    <Stat label="Vắng" value={summary?.absent ?? 0} tone="absent" />
                    <Stat label="Nghỉ phép" value={summary?.leave ?? 0} tone="leave" />
                    <Stat label="Đã vào ca" value={summary?.checkedIn ?? 0} tone="checkin" />
                    <Stat label="Đã tan ca" value={summary?.checkedOut ?? 0} tone="checkout" />
                  </dl>
                )}

                <div aria-live="polite">
                  {dayQuery.isLoading ? <TableSkeleton label="Đang tải ca làm" /> : dayQuery.isError ? (
                    <div className="banner danger" role="alert" data-testid="status-attendance-list-error"><AlertCircle size={15} /><span>Không tải được danh sách ca.</span><button type="button" onClick={() => void dayQuery.refetch()}>Thử lại</button></div>
                  ) : dayRecords.length === 0 ? (
                    <div className="empty" data-testid="status-empty-attendance"><CalendarDays size={20} /><p>{statusFilter ? 'Không có ca nào với tình trạng này trong ngày.' : 'Chưa có ca nào trong ngày này.'}</p>
                      {canEdit && !statusFilter && <button type="button" className="btn primary" onClick={() => setDialog({ record: null })} data-testid="button-add-first-attendance"><Plus size={15} />Ghi nhận ca đầu tiên</button>}
                    </div>
                  ) : (
                    <AttendanceTable records={dayRecords} caption={`Ca làm ngày ${formatShortDate(date)}`} isOwner={canEdit} showDate={false} busy={deleteRecord.isPending} onEdit={openEdit} onDelete={removeRecord} testId="day-shifts" />
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
        )}
      </main>

      <footer className="footer"><span>SỔ CÔNG · chấm công cho nhóm nhỏ</span><span>Chỉ chủ sở hữu được thay đổi dữ liệu</span></footer>

      {dialog && canEdit && (
        <AttendanceDialog record={dialog.record} members={members} busy={createRecord.isPending || updateRecord.isPending} error={operationError} initialDate={date} initialMemberId={dialog.memberId}
          onClose={() => { setDialog(null); setOperationError(''); }} onSubmit={submitRecord} />
      )}
    </div>
  );
}

function StatusSelect({ value, onChange }: { value: AttendanceStatus | ''; onChange: (v: AttendanceStatus | '') => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as AttendanceStatus | '')} aria-label="Lọc theo tình trạng" data-testid="select-attendance-status">
      <option value="">Mọi tình trạng</option>
      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`stat ${tone}`} data-testid={`stat-attendance-${tone}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button type="button" className="btn small ghost" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Đăng xuất</button>;
}
