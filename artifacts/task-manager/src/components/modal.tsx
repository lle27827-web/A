import type { ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';

export function Modal({ title, description, onClose, children, testId }: { title: string; description?: string; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <D.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <D.Portal>
        <D.Overlay className="settings-overlay" />
        <D.Content className="settings-dialog" data-testid={testId} aria-describedby={description ? undefined : undefined}>
          <div className="dialog-head">
            <D.Title asChild><h2>{title}</h2></D.Title>
            <D.Close asChild><button type="button" className="icon-btn" aria-label="Đóng"><X size={18} /></button></D.Close>
          </div>
          <D.Description className="sub" style={{ marginBottom: 14 }}>{description ?? ' '}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export type ConfirmState = { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void };

export function ConfirmDialog({ state, busy, onClose }: { state: ConfirmState; busy: boolean; onClose: () => void }) {
  return (
    <Modal title={state.title} onClose={onClose} testId="dialog-confirm">
      <div className="confirm-body"><AlertTriangle size={18} aria-hidden="true" /><div>{state.body}</div></div>
      <div className="dialog-actions" style={{ marginTop: 18 }}>
        <button type="button" className="btn ghost" onClick={onClose} data-testid="button-confirm-cancel">Hủy</button>
        <button type="button" className="btn danger" disabled={busy} onClick={state.onConfirm} data-testid="button-confirm-ok">
          {busy && <LoaderCircle size={14} className="spin" />}{state.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Skeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}>{Array.from({ length: rows }, (_, i) => <span key={i} />)}</div>;
}

export function ErrorBanner({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="banner danger" role="alert"><AlertTriangle size={15} /><span>{text}</span>{onRetry && <button type="button" onClick={onRetry}>Thử lại</button>}</div>;
}
