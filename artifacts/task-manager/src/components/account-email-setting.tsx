import { useState } from 'react';
import { Check, Copy, Mail } from 'lucide-react';

export function AccountEmailSetting({ email }: { email: string | null | undefined }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copyEmail() {
    if (!email || !navigator.clipboard?.writeText) {
      setCopyState('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(email);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <section className="account-email-setting" aria-label="Email tài khoản" data-testid="section-account-email">
      <Mail size={18} aria-hidden="true" />
      <div className="account-email-copy">
        <strong>Tài khoản đang đăng nhập</strong>
        <span data-testid="text-account-email">{email || 'Chưa có email đã xác minh'}</span>
        {copyState !== 'idle' && (
          <small role="status" aria-live="polite">
            {copyState === 'copied' ? 'Đã sao chép email.' : 'Không sao chép được; hãy chọn và sao chép email.'}
          </small>
        )}
      </div>
      <button type="button" onClick={() => void copyEmail()} disabled={!email}
        aria-label="Sao chép email tài khoản" data-testid="button-copy-account-email">
        {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{copyState === 'copied' ? 'Đã sao chép' : 'Sao chép'}</span>
      </button>
    </section>
  );
}
