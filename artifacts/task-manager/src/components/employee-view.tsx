import { useMemo } from 'react';
import type { AttendanceRecord, MemberRecord } from '@workspace/api-client-react';
import { AlertCircle, Search, UserRound } from 'lucide-react';
import { AttendanceTable, TableSkeleton } from '@/components/attendance-table';
import { initial, recordMatches } from '@/lib/attendance';

const noop = () => {};

export function EmployeeView({ employeeId, employee, membersLoading, membersError, membersReady, records, loading, error, query, onRetryMembers, onRetry, onChoose, onClearQuery }: {
  employeeId: number | null;
  employee: MemberRecord | null;
  membersLoading: boolean;
  membersError: boolean;
  membersReady: boolean;
  records: AttendanceRecord[];
  loading: boolean;
  error: boolean;
  query: string;
  onRetryMembers: () => void;
  onRetry: () => void;
  onChoose: () => void;
  onClearQuery: () => void;
}) {
  const q = query.trim();
  const sorted = useMemo(() => [...records]
    .filter((r) => employee !== null && r.memberId === employee.id && (!q || recordMatches(r, q)))
    .sort((a, b) => b.workDate.localeCompare(a.workDate) || (b.checkIn ?? '').localeCompare(a.checkIn ?? '')), [records, employee, q]);
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  sorted.forEach((r) => { counts[r.status] += 1; });

  if (membersError) return (
    <div className="employee-wrap"><div className="banner danger" role="alert"><AlertCircle size={15} /><span>Không tải được danh sách Nhân viên.</span><button type="button" onClick={onRetryMembers}>Thử lại</button></div></div>
  );
  if (membersLoading) return <div className="employee-wrap"><section className="panel"><TableSkeleton label="Đang tải Nhân viên" /></section></div>;
  if (!employee) {
    const missing = employeeId !== null && membersReady;
    return (
      <div className="employee-wrap">
        <section className="panel" aria-labelledby="choose-title">
          <div className="empty" data-testid={missing ? 'status-employee-missing' : 'status-employee-unselected'} role="status">
            <UserRound size={22} />
            <h2 id="choose-title" style={{ margin: 0, fontSize: 16 }}>{missing ? 'Nhân viên đã chọn không còn tồn tại' : 'Chưa chọn Nhân viên'}</h2>
            <p>{missing ? 'Nhân viên này có thể đã bị xóa. Hãy chọn lại Nhân viên khác để xem lịch sử ca.' : 'Chọn một Nhân viên để xem lịch sử ca của riêng người đó.'}</p>
            <button type="button" className="btn primary" onClick={onChoose} data-testid="button-choose-employee">Chọn Nhân viên</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="employee-wrap">
      <section className="panel" aria-labelledby="employee-title" data-testid="section-employee-view">
        <div className="panel-head wrap">
          <div className="employee-hero">
            <span className="initials" aria-hidden="true">{initial(employee.name)}</span>
            <div>
              <h1 id="employee-title" data-testid="text-employee-name">{employee.name}</h1>
              <p className="sub" aria-live="polite" data-testid="text-employee-stats">{loading ? 'Đang tải…' : `${sorted.length} ca${q ? ` khớp “${q}”` : ''} · ${counts.present} có mặt · ${counts.late} muộn · ${counts.absent} vắng · ${counts.leave} nghỉ phép`}</p>
            </div>
          </div>
          <div className="head-actions">
            <span className="view-only" data-testid="text-employee-readonly">Chỉ xem</span>
            <button type="button" className="btn small" onClick={onChoose} data-testid="button-change-employee">Đổi Nhân viên</button>
          </div>
        </div>
        {error ? (
          <div className="banner danger" role="alert"><AlertCircle size={15} /><span>Không tải được lịch sử ca.</span><button type="button" onClick={onRetry}>Thử lại</button></div>
        ) : loading ? <TableSkeleton label="Đang tải lịch sử ca" /> : sorted.length === 0 ? (
          <div className="empty" data-testid="status-empty-employee-history"><Search size={20} /><p>{q ? 'Không có ca nào khớp từ khóa.' : 'Nhân viên này chưa có ca nào được ghi nhận.'}</p>{q && <button type="button" className="btn" onClick={onClearQuery}>Xóa tìm kiếm</button>}</div>
        ) : (
          <AttendanceTable records={sorted} caption={`Ca làm của ${employee.name}, mới nhất trước`} canEdit={false} showDate busy={false} onEdit={noop} onDelete={noop} testId="employee-history" />
        )}
      </section>
    </div>
  );
}
