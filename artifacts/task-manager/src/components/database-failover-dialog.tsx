import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDatabaseFailoverStatusQueryKey,
  useGetDatabaseFailoverStatus,
  useRequestDatabaseFailover,
  type DatabaseFailoverTarget,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, Database, LoaderCircle, RotateCw } from 'lucide-react';
import { ErrorBanner, Modal, Skeleton } from '@/components/modal';
import { errorText } from '@/lib/massage';

const backendLabels: Record<string, string> = {
  database_url_1: 'DB1',
  database_url: 'DB2',
  database_url_3: 'DB3',
  database_url_4: 'DB4',
  switching: 'Đang chuyển',
};

function backendLabel(backend?: string) {
  return backend ? backendLabels[backend] ?? 'Không xác định' : 'Chưa tải';
}

export function DatabaseFailoverDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const status = useGetDatabaseFailoverStatus({
    query: {
      queryKey: getGetDatabaseFailoverStatusQueryKey(),
      staleTime: 0,
      refetchOnMount: 'always',
      retry: 1,
    },
  });
  const mutation = useRequestDatabaseFailover();
  const [confirmation, setConfirmation] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<DatabaseFailoverTarget | null>(null);
  const [completed, setCompleted] = useState<{ message: string; activeBackend: string } | null>(null);
  const activeBackend = status.data?.activeBackend;
  const targetStatus = status.data?.switchTargets.find((item) => item.backend === selectedTarget);
  const expectedConfirmation =
    activeBackend && selectedTarget
      ? `${backendLabel(activeBackend)} SANG ${backendLabel(selectedTarget)}`
      : '';
  const canSwitch = targetStatus?.canSwitch === true && !completed;

  function requestSwitch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canSwitch ||
      !activeBackend ||
      activeBackend === 'switching' ||
      !selectedTarget ||
      confirmation.trim() !== expectedConfirmation ||
      mutation.isPending
    ) return;
    mutation.mutate(
      {
        data: {
          fromBackend: activeBackend as DatabaseFailoverTarget,
          targetBackend: selectedTarget,
          confirmation: `${activeBackend}_TO_${selectedTarget}`,
        },
      },
      {
        onSuccess: async (result) => {
          setCompleted({ message: result.message, activeBackend: result.activeBackend });
          setConfirmation('');
          await queryClient.invalidateQueries({
            queryKey: getGetDatabaseFailoverStatusQueryKey(),
          });
        },
      },
    );
  }

  return (
    <Modal
      title="Chuyển database dự phòng"
      onClose={mutation.isPending ? () => undefined : onClose}
      testId="dialog-database-failover"
    >
      {status.isLoading ? (
        <Skeleton rows={2} label="Đang kiểm tra trạng thái database" />
      ) : status.isError ? (
        <ErrorBanner text={errorText(status.error, 'Không tải được trạng thái database.')} onRetry={() => void status.refetch()} />
      ) : (
        <>
          <div className="banner soft" role="status" data-testid="status-active-database">
            <Database size={15} aria-hidden="true" />
            <span>Database đang hoạt động: <strong>{backendLabel(status.data?.activeBackend)}</strong></span>
            {status.isFetching && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          </div>

          {completed ? (
            <div className="banner success" role="status" data-testid="status-database-failover-complete">
              {completed.message} Database hiện hoạt động: <strong>{backendLabel(completed.activeBackend)}</strong>.
            </div>
          ) : (
            <>
              <div className="banner soft" role="note">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  Ứng dụng chỉ chuyển giữa hai kho liền kề sau khi kiểm tra replication, giao dịch đang chạy, dung lượng và CU. Nếu bất kỳ bước nào không đạt, kho hiện tại được giữ nguyên.
                </span>
              </div>

              <div className="stack" aria-label="Trạng thái bốn kho database">
                {status.data?.switchTargets.map((item) => (
                  <div
                    key={item.backend}
                    className="banner soft"
                    data-testid={`database-failover-target-${item.backend}`}
                  >
                    <span>
                      <strong>{backendLabel(item.backend)}</strong>
                      {item.active ? ' · Đang hoạt động' : ` · ${item.message}`}
                    </span>
                    {!item.active && item.configured && (
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={!item.canSwitch || mutation.isPending}
                        onClick={() => {
                          setSelectedTarget(item.backend);
                          setConfirmation('');
                        }}
                        data-testid={`button-select-failover-${item.backend}`}
                      >
                        Chọn
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {selectedTarget && targetStatus?.canSwitch && (
                <form onSubmit={requestSwitch}>
                  <label className="field" htmlFor="confirm-db-failover">
                    Nhập {expectedConfirmation} để xác nhận
                    <input
                      id="confirm-db-failover"
                      autoComplete="off"
                      maxLength={48}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      disabled={!canSwitch || mutation.isPending}
                      data-testid="input-confirm-database-failover"
                    />
                  </label>

                  {mutation.isError && (
                    <ErrorBanner text={errorText(mutation.error, 'Chưa thể chuyển database an toàn.')} />
                  )}

                  <div className="dialog-actions" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setSelectedTarget(null);
                        setConfirmation('');
                      }}
                      disabled={mutation.isPending}
                      data-testid="button-cancel-database-failover"
                    >
                      Hủy chọn
                    </button>
                    <button
                      type="submit"
                      className="btn danger"
                      disabled={!canSwitch || confirmation.trim() !== expectedConfirmation || mutation.isPending}
                      data-testid="button-confirm-database-failover"
                    >
                      {mutation.isPending ? <LoaderCircle size={14} className="spin" /> : <><RotateCw size={14} aria-hidden="true" /><ArrowRight size={14} aria-hidden="true" /></>}
                      Chuyển sang {backendLabel(selectedTarget)}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
