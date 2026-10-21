import { useState, type FormEvent } from 'react';
import { LoaderCircle, Users } from 'lucide-react';
import { useCreateSampleMembersBatch } from '@workspace/api-client-react';
import { ErrorBanner, Modal } from '@/components/modal';
import { errorText } from '@/lib/massage';

const confirmationPhrase = 'TẠO 1.000 NHÂN VIÊN MẪU';

export function SampleMembersDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [confirmation, setConfirmation] = useState('');
  const mutation = useCreateSampleMembersBatch();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation.trim() !== confirmationPhrase || mutation.isPending) return;
    mutation.mutate(
      { data: { confirmation: 'TAO_1000_NHAN_VIEN_MAU' } },
      { onSuccess: (result) => onCreated(result.createdCount) },
    );
  }

  return (
    <Modal
      title="Tạo 1.000 nhân viên mẫu"
      onClose={mutation.isPending ? () => undefined : onClose}
      testId="dialog-sample-members"
    >
      <p className="sub">
        Tạo các tên từ “Nhân viên 1” đến “Nhân viên 1000” trong database đang hoạt động. Mỗi hồ sơ có mức tiền công 0 và lịch sử hồ sơ; không tạo ca làm, thẻ hay lịch hẹn. Danh sách này sẽ xuất hiện trong quản lý nhân viên.
      </p>
      <p className="hint warn" role="note">
        Chỉ chạy một lần trên Vercel Production. Nếu bất kỳ tên nào đã tồn tại, hệ thống sẽ không thêm hồ sơ nào.
      </p>
      <form onSubmit={submit}>
        <label className="field" htmlFor="confirm-sample-members">
          Nhập chính xác: {confirmationPhrase}
          <input
            id="confirm-sample-members"
            autoComplete="off"
            maxLength={64}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={mutation.isPending}
            data-testid="input-confirm-sample-members"
          />
        </label>
        {mutation.isError && (
          <ErrorBanner text={errorText(mutation.error, 'Chưa thể tạo nhân viên mẫu.')} />
        )}
        <div className="dialog-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={mutation.isPending}
            data-testid="button-cancel-sample-members"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="btn danger"
            disabled={confirmation.trim() !== confirmationPhrase || mutation.isPending}
            data-testid="button-create-sample-members"
          >
            {mutation.isPending
              ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
              : <Users size={14} aria-hidden="true" />}
            Tạo 1.000 hồ sơ
          </button>
        </div>
      </form>
    </Modal>
  );
}
