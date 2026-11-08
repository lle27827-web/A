import { useState } from 'react';
import type { BusinessSummary } from '@workspace/api-client-react';
import { ArrowLeftRight, Building2, X } from 'lucide-react';

export function BusinessSwitcher({ businesses, businessId, onSelect }: {
  businesses: BusinessSummary[];
  businessId: string | null;
  onSelect: (id: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  if (businesses.length < 2) return null;
  async function selectBusiness(id: string) {
    setError('');
    setPendingId(id);
    try {
      await onSelect(id);
      setOpen(false);
    } catch {
      setError('Máy chủ chưa xác nhận cơ sở được chọn. Không có quyền truy cập nào được thay đổi.');
    } finally {
      setPendingId(null);
    }
  }
  return (
    <>
      <button type="button" className="workspace-switch-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <ArrowLeftRight size={15} aria-hidden="true" /><span>Đổi cơ sở</span>
      </button>
      {open && <div className="workspace-switch-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="workspace-switch-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-business-title">
          <header><div><span className="workspace-eyebrow">SỔ CÔNG</span><h2 id="switch-business-title">Chọn cơ sở</h2></div><button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Đóng"><X size={18} /></button></header>
          <p className="workspace-switch-description">Bạn chỉ thấy cơ sở đã được cấp quyền cho tài khoản này.</p>
          <div className="workspace-switch-list">
            {businesses.map((business) => <button type="button" key={business.id} className="workspace-switch-option" disabled={pendingId !== null} aria-current={business.id === businessId ? 'true' : undefined} onClick={() => void selectBusiness(business.id)}>
              <span className="workspace-switch-icon"><Building2 size={17} aria-hidden="true" /></span>
              <span><strong>{business.name}</strong><small>{business.role === 'owner' ? 'Chủ sở hữu' : business.role === 'platform_admin' ? 'Quản trị nền tảng' : 'Nhân viên'}</small></span>
              {business.id === businessId && <span className="workspace-current">Đang mở</span>}
              {pendingId === business.id && <span className="workspace-current">Đang xác minh…</span>}
            </button>)}
          </div>
          {error && <p className="workspace-switch-error" role="alert">{error}</p>}
        </section>
      </div>}
    </>
  );
}
