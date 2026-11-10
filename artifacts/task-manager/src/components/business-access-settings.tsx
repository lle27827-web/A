import { useState, type FormEvent } from 'react';
import {
  useCreateBusiness,
  useLeaveBusiness,
  useJoinBusiness,
  useRotateBusinessJoinCode,
} from '@workspace/api-client-react';
import type { AuthStatus, BusinessAccessResult } from '@workspace/api-client-react';
import { ArrowRight, BookHeart, Building2, Check, Copy, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import { ConfirmDialog, type ConfirmState } from '@/components/modal';
import { getApiErrorMessage } from '@/lib/api-error-message';
import { readBusinessRolePreference } from '@/lib/business-role-preference';

type RoleChoice = 'personal' | 'owner' | 'employee';

type Props = {
  mode?: 'settings' | 'onboarding';
  status: AuthStatus;
  onBusinessSelected: (id: string) => Promise<void> | void;
  onContinuePersonal: () => void;
  onRefreshStatus: () => Promise<AuthStatus | undefined>;
  onCloseSettings?: () => void;
  onRoleSelected?: (role: RoleChoice) => void;
  onRoleFlowCompleted?: () => void;
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
    permissions.compareAllEmployees || permissions.compareEmployeeIds.length > 0 ||
    permissions.viewCards || permissions.viewRevenue || permissions.editEmployees ||
    permissions.deleteEmployees || permissions.editCards || permissions.editServices ||
    permissions.viewAppointments || permissions.editAppointments;
}

export function BusinessAccessSettings({
  mode = 'settings',
  status,
  onBusinessSelected,
  onContinuePersonal,
  onRefreshStatus,
  onCloseSettings,
  onRoleSelected,
  onRoleFlowCompleted,
}: Props) {
  const isOnboarding = mode === 'onboarding';
  const [role, setRole] = useState<RoleChoice>(() =>
    readBusinessRolePreference(status.userId) ?? currentRole(status),
  );
  const [setupRole, setSetupRole] = useState<RoleChoice | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [created, setCreated] = useState<BusinessAccessResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState<ConfirmState | null>(null);
  const createBusiness = useCreateBusiness();
  const joinBusiness = useJoinBusiness();
  const rotateJoinCode = useRotateBusinessJoinCode();
  const leaveBusiness = useLeaveBusiness();
  const busy = createBusiness.isPending || joinBusiness.isPending || rotateJoinCode.isPending || leaveBusiness.isPending;
  const businesses = status.businesses ?? [];
  const activeBusiness = businesses.find((business) => business.id === status.businessId);
  const activeOwnerBusiness = activeBusiness?.role === 'owner' ? activeBusiness : null;
  const selectedRole = isOnboarding ? setupRole : role;
  const canLeaveActiveBusiness = Boolean(
    activeBusiness &&
    activeBusiness.role === 'employee' &&
    status.role === 'employee' &&
    !status.isPlatformAdmin,
  );

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setCreated(null);
    try {
      const result = await createBusiness.mutateAsync({ data: { name: businessName.trim() } });
      onRoleSelected?.('owner');
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
        data: { code: joinCode },
      });
      onRoleSelected?.('employee');
      setJoinCode('');
      if (isOnboarding) {
        await onBusinessSelected(result.business.id);
        return;
      }
      await onRefreshStatus();
      setNotice(`Đã liên kết tài khoản với “${result.business.name}”. Chủ cơ sở cần cấp quyền trước khi bạn xem dữ liệu.`);
      onRoleFlowCompleted?.();
    } catch (caught) {
      setError(getApiErrorMessage(caught) ?? 'Chưa thể tham gia cơ sở. Hãy kiểm tra mã và thử lại.');
    }
  }

  async function activateBusiness(id: string) {
    setError('');
    setNotice('');
    if (created?.business.id !== id) setCreated(null);
    try {
      const selected = businesses.find((business) => business.id === id);
      if (selected) onRoleSelected?.(selected.role === 'owner' || selected.role === 'platform_admin' ? 'owner' : 'employee');
      await onBusinessSelected(id);
    } catch {
      setError('Máy chủ chưa xác nhận cơ sở được chọn. Quyền truy cập không thay đổi.');
    }
  }

  async function leaveSelectedBusiness() {
    if (!activeBusiness || !canLeaveActiveBusiness || leaveBusiness.isPending) return;
    setError('');
    setNotice('');
    try {
      await leaveBusiness.mutateAsync({ id: activeBusiness.id });
      setLeaveConfirm(null);
      await onRefreshStatus();
      setNotice(`Đã rời “${activeBusiness.name}”. Đăng nhập, sổ cá nhân, dữ liệu cơ sở và quyền ở cơ sở khác vẫn được giữ.`);
    } catch {
      setError('Chưa thể hoàn tất việc rời cơ sở. Hãy tải lại trạng thái và thử lại.');
    }
  }

  function askLeaveSelectedBusiness() {
    if (!activeBusiness || !canLeaveActiveBusiness) return;
    setLeaveConfirm({
      title: `Rời khỏi “${activeBusiness.name}”?`,
      body: (
        <p>
          Thao tác này gỡ membership và quyền quản lý riêng của tài khoản ở cơ sở đang chọn.
          Tài khoản đăng nhập, sổ cá nhân, dữ liệu và lịch sử của cơ sở, cùng các cơ sở khác sẽ không bị xóa.
          Chủ cơ sở cần chuyển quyền sở hữu trước khi rời.
        </p>
      ),
      confirmLabel: 'Rời khỏi cơ sở',
      onConfirm: () => { void leaveSelectedBusiness(); },
    });
  }

  async function rotateCode(businessId: string) {
    setError('');
    setNotice('');
    try {
      setCreated(await rotateJoinCode.mutateAsync({ id: businessId }));
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

  function selectRole(nextRole: RoleChoice) {
    setRole(nextRole);
    setError('');
    setNotice('');
    setCreated(null);
    onRoleSelected?.(nextRole);
    if (isOnboarding) {
      setSetupRole(nextRole);
      if (nextRole === 'personal') onContinuePersonal();
    }
  }

  function returnToRoleChoices() {
    setSetupRole(null);
    setError('');
    setNotice('');
    setCreated(null);
  }

  const roleChoices: RoleChoice[] = isOnboarding
    ? ['owner', 'employee', 'personal']
    : ['personal', 'owner', 'employee'];

  return (
    <section className="business-access-settings" aria-labelledby={isOnboarding ? undefined : 'business-access-title'}
      aria-label={isOnboarding ? 'Chọn vai trò' : undefined}>
      {!isOnboarding && (
        <div className="business-access-heading">
          <h3 id="business-access-title">Vai trò và cơ sở</h3>
          <p>Chưa chọn vai trò thì mặc định sử dụng sổ cá nhân. Quyền cơ sở do máy chủ xác minh.</p>
        </div>
      )}
      {status.businessAccessAvailable === false && (
        <div className="banner danger" role="status" data-testid="status-business-access-unavailable">
          Kho doanh nghiệp chưa sẵn sàng. Sổ cá nhân vẫn dùng được; chưa thể mở, tạo hoặc tham gia cơ sở.
        </div>
      )}

      {isOnboarding && selectedRole ? (
        <div className="business-role-selected">
          <button type="button" className="link-soft as-button" onClick={returnToRoleChoices}>
            <ArrowRight size={14} aria-hidden="true" className="back-arrow" />Chọn vai trò khác
          </button>
          <strong>{selectedRole === 'owner' ? 'Chủ doanh nghiệp' : selectedRole === 'employee' ? 'Nhân viên' : 'Sổ cá nhân'}</strong>
        </div>
      ) : (
        <div className={`business-role-options${isOnboarding ? ' onboarding-role-options' : ''}`} role="group" aria-label="Chọn vai trò">
          {roleChoices.map((choice) => (
            <button key={choice} type="button" aria-pressed={!isOnboarding ? role === choice : undefined}
              className={!isOnboarding && role === choice ? 'selected' : ''}
              onClick={() => selectRole(choice)}>
              {choice === 'owner' ? <Building2 size={16} aria-hidden="true" /> :
                choice === 'employee' ? <KeyRound size={16} aria-hidden="true" /> :
                  <BookHeart size={16} aria-hidden="true" />}
              <span>{choice === 'owner' ? 'Chủ doanh nghiệp' : choice === 'employee' ? 'Nhân viên' : 'Sổ cá nhân'}</span>
            </button>
          ))}
        </div>
      )}

      {selectedRole === 'personal' ? (
        isOnboarding ? null : (
        <div className="business-role-panel">
          <p>Sổ cá nhân là lựa chọn mặc định và chỉ lưu dữ liệu của tài khoản này.</p>
          <button type="button" className="btn small" onClick={() => { onCloseSettings?.(); onContinuePersonal(); }}>
            <BookHeart size={15} aria-hidden="true" />Mở sổ cá nhân
          </button>
        </div>)
      ) : selectedRole === 'owner' ? (
        <div className="business-role-panel">
          <p>Mỗi doanh nghiệp có dữ liệu riêng. Mã tham gia chỉ dùng để kết nối tài khoản nhân viên.</p>
          {created ? (
            <div className="business-created" role="status">
              {created.joinCode ? (
                <>
                  <div className="business-owner-summary">
                    <div>
                      <span className="business-access-label">DOANH NGHIỆP</span>
                      <strong>{created.business.name}</strong>
                    </div>
                    <div>
                      <span className="business-access-label">MÃ THAM GIA</span>
                      <div className="workspace-code" aria-label={`Mã tham gia ${created.joinCode}`}>
                        {created.joinCode.split('').map((digit, index) => <span key={`${index}-${digit}`}>{digit}</span>)}
                      </div>
                    </div>
                  </div>
                  <p>Tạo mã khác sẽ vô hiệu mã đang hiển thị; nhân viên đã liên kết vẫn giữ nguyên quyền.</p>
                  <div className="business-access-actions">
                    <button type="button" className="btn small" onClick={() => void copyCode()}>
                      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                      {copied ? 'Đã sao chép' : 'Sao chép mã'}
                    </button>
                    <button type="button" className="btn small" onClick={() => void rotateCode(created.business.id)} disabled={busy}>
                      <RefreshCw size={14} aria-hidden="true" />Tạo mã mới
                    </button>
                    <button type="button" className="btn primary small" onClick={() => void activateBusiness(created.business.id)}>
                      {isOnboarding ? 'Tiếp tục' : 'Mở cơ sở'}<ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="business-access-label">DOANH NGHIỆP</span>
                  <strong>{created.business.name}</strong>
                  <p>Mã tham gia chưa được máy chủ trả về. Hãy thử tạo mã mới.</p>
                </>
              )}
            </div>
          ) : activeOwnerBusiness ? (
            <div className="business-created" data-testid="active-business-settings">
              <span className="business-access-label">DOANH NGHIỆP</span>
              <strong>{activeOwnerBusiness.name}</strong>
              <p>Mã hiện tại không thể xem lại. Tạo mã mới sẽ vô hiệu mã tham gia cũ nhưng không ảnh hưởng nhân viên đã liên kết.</p>
              <button type="button" className="btn primary small" onClick={() => void rotateCode(activeOwnerBusiness.id)} disabled={busy}>
                {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                Tạo mã mới
              </button>
            </div>
          ) : (
            <form className="business-access-form" onSubmit={(event) => void createWorkspace(event)} aria-busy={busy}>
              <label className="field" htmlFor="settings-business-create-name">Tên doanh nghiệp
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
      ) : selectedRole === 'employee' ? (
        <div className="business-role-panel">
          {activeBusiness?.role === 'employee' && (
            <div className="business-current" data-testid="active-employee-business">
              <span className="business-access-label">DOANH NGHIỆP ĐANG THAM GIA</span>
              <strong>{activeBusiness.name}</strong>
            </div>
          )}
          <p>Nhập mã doanh nghiệp gồm 10 chữ số. Chủ cơ sở vẫn cần cấp quyền trước khi tài khoản xem dữ liệu.</p>
          <form className="business-access-form" onSubmit={(event) => void joinWorkspace(event)} aria-busy={busy}>
            <label className="field" htmlFor="settings-business-join-code">Mã doanh nghiệp
              <input id="settings-business-join-code" value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{10}" required
                placeholder="Mã gồm 10 chữ số" />
            </label>
            <button type="submit" className="btn primary" disabled={busy || joinCode.length !== 10}>
              {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
              {isOnboarding ? 'Tiếp tục' : 'Tham gia cơ sở'}
            </button>
          </form>
        </div>
      ) : null}

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

      {canLeaveActiveBusiness && activeBusiness && (
        <div className="business-leave-action">
          <p>Rời chỉ áp dụng cho “{activeBusiness.name}”; các cơ sở khác và sổ cá nhân vẫn giữ nguyên.</p>
          <button type="button" className="btn danger" onClick={askLeaveSelectedBusiness} disabled={busy}>
            Rời khỏi cơ sở đang chọn
          </button>
        </div>
      )}

      {error && <p className="business-access-message error" role="alert">{error}</p>}
      {notice && <p className="business-access-message" role="status">{notice}</p>}
      {leaveConfirm && <ConfirmDialog state={leaveConfirm} busy={leaveBusiness.isPending} onClose={() => setLeaveConfirm(null)} />}
    </section>
  );
}
