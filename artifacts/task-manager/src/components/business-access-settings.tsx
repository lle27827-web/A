import { useState, type FormEvent } from 'react';
import {
  useCreateBusiness,
  useJoinBusiness,
  useRotateBusinessJoinCode,
} from '@workspace/api-client-react';
import type { AuthStatus, BusinessAccessResult } from '@workspace/api-client-react';
import { ArrowRight, BookHeart, Building2, Check, Copy, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';

type RoleChoice = 'personal' | 'owner' | 'employee';

type Props = {
  status: AuthStatus;
  onBusinessSelected: (id: string) => Promise<void> | void;
  onContinuePersonal: () => void;
  onRefreshStatus: () => Promise<AuthStatus | undefined>;
  onCloseSettings?: () => void;
};

function currentRole(status: AuthStatus): RoleChoice {
  if (status.businessId) {
    const current = status.businesses.find((business) => business.id === status.businessId);
    if (current?.role === 'owner' || current?.role === 'platform_admin' || status.isOwner) return 'owner';
    if (current) return 'employee';
  }
  return 'personal';
}

function roleLabel(role: string) {
  if (role === 'owner') return 'Chủ doanh nghiệp';
  if (role === 'platform_admin') return 'Quản trị nền tảng';
  return 'Nhân viên';
}

function hasFacilityPermission(status: AuthStatus) {
  const permissions = status.permissions;
  return status.isOwner || permissions.allEmployees || permissions.employeeIds.length > 0 ||
    permissions.viewCards || permissions.viewRevenue || permissions.editEmployees ||
    permissions.deleteEmployees || permissions.editCards || permissions.editServices ||
    permissions.viewAppointments || permissions.editAppointments;
}

export function BusinessAccessSettings({
  status,
  onBusinessSelected,
  onContinuePersonal,
  onRefreshStatus,
  onCloseSettings,
}: Props) {
  const [role, setRole] = useState<RoleChoice>(() => currentRole(status));
  const [businessName, setBusinessName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [created, setCreated] = useState<BusinessAccessResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const createBusiness = useCreateBusiness();
  const joinBusiness = useJoinBusiness();
  const rotateJoinCode = useRotateBusinessJoinCode();
  const busy = createBusiness.isPending || joinBusiness.isPending || rotateJoinCode.isPending;
  const businesses = status.businesses ?? [];

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setCreated(null);
    try {
      const result = await createBusiness.mutateAsync({ data: { name: businessName.trim() } });
      setCreated(result);
      setBusinessName('');
      await onRefreshStatus();
      setNotice('Đã tạo cơ sở. Mã tham gia chỉ hiển thị tại đây; hãy lưu lại và chia sẻ riêng với nhân viên.');
    } catch {
      setError('Chưa thể tạo cơ sở. Hãy kiểm tra tên và thử lại.');
    }
  }

  async function joinWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await joinBusiness.mutateAsync({
        data: { businessName: businessName.trim(), code: joinCode },
      });
      setBusinessName('');
      setJoinCode('');
      await onRefreshStatus();
      setNotice(`Đã liên kết tài khoản với “${result.business.name}”. Chủ cơ sở cần cấp quyền trước khi bạn xem dữ liệu.`);
    } catch {
      setError('Tên cơ sở và mã tham gia không khớp, hoặc mã đã bị đổi. Hãy kiểm tra lại.');
    }
  }

  async function activateBusiness(id: string) {
    setError('');
    setNotice('');
    try {
      await onBusinessSelected(id);
    } catch {
      setError('Máy chủ chưa xác nhận cơ sở được chọn. Quyền truy cập không thay đổi.');
    }
  }

  async function rotateCode() {
    if (!created) return;
    setError('');
    setNotice('');
    try {
      setCreated(await rotateJoinCode.mutateAsync({ id: created.business.id }));
      setNotice('Mã mới đã tạo. Mã cũ không còn hiệu lực.');
    } catch {
      setError('Chưa thể đổi mã. Mã hiện tại vẫn còn hiệu lực.');
    }
  }

  async function copyCode() {
    if (!created?.joinCode) return;
    try {
      await navigator.clipboard.writeText(created.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Không sao chép được mã trên thiết bị này. Anh có thể ghi lại mã đang hiển thị.');
    }
  }

  return (
    <section className="business-access-settings" aria-labelledby="business-access-title">
      <div className="business-access-heading">
        <h3 id="business-access-title">Vai trò và cơ sở</h3>
        <p>Chưa chọn vai trò thì mặc định sử dụng sổ cá nhân. Quyền cơ sở do máy chủ xác minh.</p>
      </div>

      <div className="business-role-options" role="group" aria-label="Chọn vai trò">
        <button type="button" aria-pressed={role === 'personal'} className={role === 'personal' ? 'selected' : ''}
          onClick={() => { setRole('personal'); setCreated(null); setError(''); setNotice(''); }}>
          <BookHeart size={16} aria-hidden="true" /><span>Sổ cá nhân</span>
        </button>
        <button type="button" aria-pressed={role === 'owner'} className={role === 'owner' ? 'selected' : ''}
          onClick={() => { setRole('owner'); setCreated(null); setError(''); setNotice(''); }}>
          <Building2 size={16} aria-hidden="true" /><span>Chủ doanh nghiệp</span>
        </button>
        <button type="button" aria-pressed={role === 'employee'} className={role === 'employee' ? 'selected' : ''}
          onClick={() => { setRole('employee'); setCreated(null); setError(''); setNotice(''); }}>
          <KeyRound size={16} aria-hidden="true" /><span>Nhân viên</span>
        </button>
      </div>

      {role === 'personal' ? (
        <div className="business-role-panel">
          <p>Sổ cá nhân là lựa chọn mặc định và chỉ lưu dữ liệu của tài khoản này.</p>
          <button type="button" className="btn small" onClick={() => { onCloseSettings?.(); onContinuePersonal(); }}>
            <BookHeart size={15} aria-hidden="true" />Mở sổ cá nhân
          </button>
        </div>
      ) : role === 'owner' ? (
        <div className="business-role-panel">
          <p>Mỗi cơ sở được phân vùng riêng theo mã doanh nghiệp trong bốn database hiện có.</p>
          {created ? (
            <div className="business-created" role="status">
              <strong>{created.business.name}</strong>
              {created.joinCode ? (
                <>
                  <div className="workspace-code" aria-label={`Mã tham gia ${created.joinCode}`}>
                    {created.joinCode.split('').map((digit, index) => <span key={`${index}-${digit}`}>{digit}</span>)}
                  </div>
                  <div className="business-access-actions">
                    <button type="button" className="btn small" onClick={() => void copyCode()}>
                      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      {copied ? 'Đã sao chép' : 'Sao chép mã'}
                    </button>
                    <button type="button" className="btn small" onClick={() => void rotateCode()} disabled={busy}>
                      <RefreshCw size={14} aria-hidden="true" />Đổi mã
                    </button>
                    <button type="button" className="btn primary small" onClick={() => void activateBusiness(created.business.id)}>
                      Mở cơ sở<ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </>
              ) : <p>Mã tham gia chưa được máy chủ trả về. Hãy thử tạo mã mới.</p>}
            </div>
          ) : (
            <form className="business-access-form" onSubmit={(event) => void createWorkspace(event)} aria-busy={busy}>
              <label className="field" htmlFor="settings-business-create-name">Tên cơ sở
                <input id="settings-business-create-name" value={businessName} onChange={(event) => setBusinessName(event.target.value)}
                  minLength={2} maxLength={120} required autoComplete="organization" placeholder="Nhập tên doanh nghiệp" />
              </label>
              <button type="submit" className="btn primary" disabled={busy || businessName.trim().length < 2}>
                {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Building2 size={15} aria-hidden="true" />}
                Tạo cơ sở
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="business-role-panel">
          <p>Nhập đúng tên cơ sở và mã 10 chữ số. Chủ cơ sở vẫn cần cấp quyền trước khi tài khoản xem dữ liệu.</p>
          <form className="business-access-form" onSubmit={(event) => void joinWorkspace(event)} aria-busy={busy}>
            <label className="field" htmlFor="settings-business-join-name">Tên cơ sở
              <input id="settings-business-join-name" value={businessName} onChange={(event) => setBusinessName(event.target.value)}
                minLength={2} maxLength={120} required autoComplete="organization" placeholder="Nhập tên do chủ cơ sở cung cấp" />
            </label>
            <label className="field" htmlFor="settings-business-join-code">Mã doanh nghiệp
              <input id="settings-business-join-code" value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{10}" required
                placeholder="Mã gồm 10 chữ số" />
            </label>
            <button type="submit" className="btn primary" disabled={busy || businessName.trim().length < 2 || joinCode.length !== 10}>
              {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
              Tham gia cơ sở
            </button>
          </form>
        </div>
      )}

      {businesses.length > 0 && (
        <div className="business-connected-list">
          <h4>Cơ sở đã liên kết</h4>
          {businesses.map((business) => (
            <button type="button" className="business-connected-row" key={business.id}
              aria-current={status.businessId === business.id ? 'true' : undefined}
              disabled={busy} onClick={() => void activateBusiness(business.id)}>
              <span><strong>{business.name}</strong><small>{roleLabel(business.role)}</small></span>
              {status.businessId === business.id ? <small>{hasFacilityPermission(status) ? 'Đang mở' : 'Chưa có quyền cơ sở'}</small> : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}

      {error && <p className="business-access-message error" role="alert">{error}</p>}
      {notice && <p className="business-access-message" role="status">{notice}</p>}
    </section>
  );
}
