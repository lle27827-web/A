import { useState, type FormEvent } from 'react';
import { useCreateBusiness, useJoinBusiness, useRotateBusinessJoinCode } from '@workspace/api-client-react';
import type { AuthStatus, BusinessAccessResult, BusinessSummary } from '@workspace/api-client-react';
import { ArrowRight, BookHeart, Building2, Check, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';

type Props = {
  status: AuthStatus;
  onBusinessSelected: (id: string) => Promise<void> | void;
  onContinuePersonal: () => void;
  onRefreshStatus: () => Promise<AuthStatus | undefined>;
};

function roleName(role: BusinessSummary['role']) {
  if (role === 'owner') return 'Chủ sở hữu';
  if (role === 'platform_admin') return 'Quản trị nền tảng';
  return 'Nhân viên';
}

export function BusinessOnboarding({ status, onBusinessSelected, onContinuePersonal, onRefreshStatus }: Props) {
  const [mode, setMode] = useState<'personal' | 'create' | 'join'>('personal');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<BusinessAccessResult | null>(null);
  const createBusiness = useCreateBusiness();
  const joinBusiness = useJoinBusiness();
  const rotateJoinCode = useRotateBusinessJoinCode();
  const pending = createBusiness.isPending || joinBusiness.isPending || rotateJoinCode.isPending;
  const businesses = status.businesses ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setResult(null);
    try {
      const access = mode === 'create'
        ? await createBusiness.mutateAsync({ data: { name: name.trim() } })
        : await joinBusiness.mutateAsync({ data: { code: code.replace(/\D/g, '') } });
      if (mode === 'create') {
        setResult(access);
        setName('');
      } else {
        await onRefreshStatus();
        await onBusinessSelected(access.business.id);
      }
    } catch {
      setError(mode === 'create'
        ? 'Chưa thể tạo không gian làm việc. Hãy kiểm tra tên cơ sở và thử lại.'
        : 'Mã tham gia không hợp lệ hoặc đã hết hạn. Hãy kiểm tra đủ 10 chữ số.');
    }
  }

  async function enterBusiness(id: string) {
    setError('');
    setNotice('');
    try {
      await onBusinessSelected(id);
    } catch {
      setError('Máy chủ chưa xác nhận cơ sở được chọn. Không có quyền truy cập nào được thay đổi.');
    }
  }

  async function rotateCode() {
    if (!result || !window.confirm('Mã cũ sẽ ngừng hoạt động. Bạn có muốn tạo mã tham gia mới không?')) return;
    setError('');
    try {
      setResult(await rotateJoinCode.mutateAsync({ id: result.business.id }));
    } catch {
      setError('Chưa thể tạo mã mới. Mã hiện tại vẫn còn hiệu lực.');
    }
  }

  return (
    <main className="workspace-page" aria-labelledby="workspace-title">
      <div className="workspace-topline">
        <a className="workspace-brand" href="/" aria-label="Sổ Công, trang chính">
          <span className="workspace-brand-mark"><Building2 size={18} aria-hidden="true" /></span>
          <span>SỔ CÔNG</span>
        </a>
        {status.email && <span className="workspace-email">{status.email}</span>}
      </div>
      <section className="workspace-intro">
        <div className="workspace-kicker"><span /> KHÔNG GIAN LÀM VIỆC CỦA BẠN</div>
        <h1 id="workspace-title">{businesses.length ? 'Chọn nơi bạn muốn tiếp tục' : 'Bắt đầu từ cuốn sổ của bạn'}</h1>
        <p>Mỗi cơ sở có dữ liệu riêng. Sổ cá nhân luôn thuộc về bạn, dù bạn làm việc ở đâu.</p>
      </section>

      {businesses.length > 0 && (
        <section className="workspace-businesses" aria-labelledby="business-list-title">
          <div className="workspace-section-heading">
            <div><span className="workspace-eyebrow">ĐÃ ĐƯỢC CẤP QUYỀN</span><h2 id="business-list-title">Cơ sở của bạn</h2></div>
            <span className="workspace-count">{businesses.length} cơ sở</span>
          </div>
          <div className="workspace-business-list">
            {businesses.map((business, index) => (
              <button className="workspace-business" type="button" key={business.id}
                onClick={() => void enterBusiness(business.id)} disabled={pending}
                aria-current={status.businessId === business.id ? 'true' : undefined}>
                <span className="workspace-business-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="workspace-business-copy"><strong>{business.name}</strong><small>{roleName(business.role)}{status.businessId === business.id ? ' · Đang mở' : ''}</small></span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="workspace-actions" aria-label="Tạo hoặc tham gia cơ sở">
        <div className="workspace-action-tabs" role="tablist" aria-label="Cách bắt đầu">
          <button type="button" role="tab" aria-selected={mode === 'personal'} className={mode === 'personal' ? 'selected' : ''} onClick={() => { setMode('personal'); setError(''); }}>
            <BookHeart size={16} aria-hidden="true" /> Sổ cá nhân
          </button>
          <button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); setError(''); }}>
            <Building2 size={16} aria-hidden="true" /> Tạo cơ sở
          </button>
          <button type="button" role="tab" aria-selected={mode === 'join'} className={mode === 'join' ? 'selected' : ''} onClick={() => { setMode('join'); setError(''); }}>
            <KeyRound size={16} aria-hidden="true" /> Tham gia bằng mã
          </button>
        </div>
        {mode === 'personal' ? (
          <div className="workspace-success">
            <span className="workspace-success-icon"><BookHeart size={20} aria-hidden="true" /></span>
            <div>
              <span className="workspace-eyebrow">DỮ LIỆU RIÊNG CỦA BẠN</span>
              <h2>Sổ cá nhân</h2>
              <p>Đây là lựa chọn mặc định nếu bạn chưa mở cơ sở hoặc tham gia bằng mã.</p>
              <button type="button" className="btn primary" onClick={onContinuePersonal}>
                <span>Mở sổ cá nhân</span><ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : mode === 'create' && result ? (
          <div className="workspace-success" role="status">
            <span className="workspace-success-icon"><Check size={20} aria-hidden="true" /></span>
            <div>
              <span className="workspace-eyebrow">CƠ SỞ ĐÃ SẴN SÀNG</span>
              <h2>{result.business.name}</h2>
              <p>Mã tham gia chỉ hiển thị ở bước này. Hãy lưu lại và chia sẻ riêng với nhân viên.</p>
              {result.joinCode ? <div className="workspace-code" aria-label={`Mã tham gia ${result.joinCode}`}>{result.joinCode.split('').map((digit, index) => <span key={`${index}-${digit}`}>{digit}</span>)}</div> : <p className="workspace-no-code">Máy chủ chưa cấp mã tham gia cho cơ sở này.</p>}
              <button type="button" className="btn small" onClick={() => void rotateCode()} disabled={pending}>Tạo mã tham gia mới</button>
              <button type="button" className="btn primary" onClick={() => void enterBusiness(result.business.id)}><span>Mở cơ sở</span><ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
        ) : (
          <form className="workspace-form" onSubmit={(event) => void submit(event)} aria-busy={pending}>
            {mode === 'create' ? (
              <>
                <label className="field" htmlFor="business-name">Tên cơ sở
                  <input id="business-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required placeholder="Ví dụ: Tiệm chăm sóc An Nhiên" autoComplete="organization" />
                </label>
                <p className="workspace-form-note"><ShieldCheck size={15} aria-hidden="true" /> Bạn sẽ là chủ sở hữu và có thể mời nhân viên bằng mã riêng.</p>
                <button className="btn primary workspace-submit" type="submit" disabled={pending || name.trim().length < 2}>
                  {pending ? <><LoaderCircle size={16} className="spin" aria-hidden="true" /> Đang tạo…</> : <>Tạo không gian làm việc <ArrowRight size={16} aria-hidden="true" /></>}
                </button>
              </>
            ) : (
              <>
                <label className="field" htmlFor="business-code">Mã tham gia gồm 10 chữ số
                  <input id="business-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{10}" required placeholder="Nhập mã do chủ cơ sở cung cấp" aria-describedby="business-code-help" />
                </label>
                <p id="business-code-help" className="workspace-form-note"><KeyRound size={15} aria-hidden="true" /> Mã chỉ dùng để yêu cầu tham gia. Quyền truy cập do máy chủ xác nhận.</p>
                <button className="btn primary workspace-submit" type="submit" disabled={pending || code.length !== 10}>
                  {pending ? <><LoaderCircle size={16} className="spin" aria-hidden="true" /> Đang xác minh…</> : <>Tham gia cơ sở <ArrowRight size={16} aria-hidden="true" /></>}
                </button>
              </>
            )}
          </form>
        )}
        {error && <div className="workspace-message error" role="alert">{error}</div>}
        {notice && <div className="workspace-message" role="status">{notice}</div>}
      </section>

      <p className="workspace-footnote"><RefreshCw size={13} aria-hidden="true" /> Quyền truy cập luôn được xác minh lại khi bạn chuyển không gian.</p>
    </main>
  );
}
