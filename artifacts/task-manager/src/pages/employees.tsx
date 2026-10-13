import { useMemo, useState } from 'react';
import { useCreateMember } from '@workspace/api-client-react';
import { AlertCircle, ArrowLeft, ChevronRight, LockKeyhole, Plus, Users } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { MemberDialog } from '@/components/entity-dialogs';
import { ErrorBanner, Skeleton } from '@/components/modal';
import { initial, normalize } from '@/lib/attendance';
import { errorText, formatVnd, useRefreshMassage } from '@/lib/massage';

export default function EmployeesPage() {
  const { members, membersLoading, membersError, retryMembers, canEdit, query, notify, fail } = useShell();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const create = useCreateMember();
  const refresh = useRefreshMassage();
  const list = useMemo(() => members.filter((m) => normalize(m.name).includes(normalize(query))), [members, query]);

  return (
    <section className="panel page" aria-labelledby="emp-title">
      <Link href="/" className="back" data-testid="link-back"><ArrowLeft size={15} />Trang chính</Link>
      <div className="panel-head wrap">
        <div><h1 id="emp-title" className="page-title">Quản lý nhân viên</h1><p className="sub">{members.length} nhân viên · chọn một người để xem lương và ca phục vụ</p></div>
        {canEdit ? <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }} data-testid="button-add-member"><Plus size={15} />Thêm nhân viên</button>
          : <span className="view-only"><LockKeyhole size={13} />Chỉ xem</span>}
      </div>
      {membersLoading ? <Skeleton rows={5} label="Đang tải nhân viên" /> : membersError ? <ErrorBanner text="Không tải được danh sách nhân viên." onRetry={retryMembers} /> : list.length === 0 ? (
        <div className="empty"><Users size={22} /><p>{members.length ? 'Không có nhân viên khớp tìm kiếm.' : 'Chưa có nhân viên nào.'}</p>
          {canEdit && !members.length && <button type="button" className="btn primary" onClick={() => setOpen(true)}><Plus size={15} />Thêm nhân viên đầu tiên</button>}</div>
      ) : (
        <ul className="emp-list">
          {list.map((m) => (
            <li key={m.id}>
              <Link href={`/employees/${m.id}`} className="emp-row" data-testid={`link-employee-${m.id}`}>
                <span className="initials big">{initial(m.name)}</span>
                <span className="grow"><strong>{m.name}</strong>
                  {m.hourlyRate > 0 ? <span className="muted mono">{formatVnd(m.hourlyRate)} / giờ</span> : <span className="warn-text"><AlertCircle size={12} />Chưa đặt lương giờ</span>}
                </span>
                <ChevronRight size={18} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && canEdit && (
        <MemberDialog member={null} busy={create.isPending} serverError={dialogError} onClose={() => setOpen(false)}
          onSubmit={(data) => create.mutate({ data }, {
            onSuccess: (m) => { refresh({ members: true }); setOpen(false); notify(`Đã thêm nhân viên ${m.name}.`); navigate(`/employees/${m.id}`); },
            onError: (e) => { setDialogError(errorText(e)); fail(e); },
          })} />
      )}
    </section>
  );
}
