import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDatabaseFailoverStatusQueryKey,
  useGetDatabaseFailoverStatus,
  useRequestDatabaseFailover,
  type DatabaseFailoverTarget,
} from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, Database, LoaderCircle, Play, RotateCw, Square } from 'lucide-react';
import { ErrorBanner, Modal, Skeleton } from '@/components/modal';
import { errorText } from '@/lib/massage';

const failoverOrder: DatabaseFailoverTarget[] = [
  'database_url_1',
  'database_url',
  'database_url_3',
  'database_url_4',
];
const maxCapacityTestWrites = 60;
const capacityTestIntervalMs = 31_000;
const capacityTestConfirmPhrase = '30 111999';

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
  const { getToken } = useAuth();
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
  const [capacityTestConfirmation, setCapacityTestConfirmation] = useState('');
  const [capacityTestRunning, setCapacityTestRunning] = useState(false);
  const [capacityTestProgress, setCapacityTestProgress] = useState(0);
  const [capacityTestResult, setCapacityTestResult] = useState('');
  const capacityTestController = useRef<AbortController | null>(null);
  const activeBackend = status.data?.activeBackend;
  const targetStatus = status.data?.switchTargets.find((item) => item.backend === selectedTarget);
  const activeIndex = activeBackend ? failoverOrder.indexOf(activeBackend as DatabaseFailoverTarget) : -1;
  const nextBackend = activeIndex >= 0 ? failoverOrder[activeIndex + 1] : undefined;
  const nextBackendStatus = nextBackend
    ? status.data?.switchTargets.find((item) => item.backend === nextBackend)
    : undefined;
  const expectedConfirmation =
    activeBackend && selectedTarget
      ? `${backendLabel(activeBackend)} SANG ${backendLabel(selectedTarget)}`
      : '';
  const canSwitch = targetStatus?.canSwitch === true && !completed;

  function requestSwitch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canSwitch ||
      capacityTestRunning ||
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

  async function writeCapacityProbe(): Promise<{ activeBackend: string }> {
    const token = await getToken();
    if (!token) throw new Error('Phiên đăng nhập chủ sở hữu đã hết hạn.');
    const response = await fetch('/api/database/failover/capacity-probe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({})) as {
      activeBackend?: string;
      error?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? payload.message ?? `Yêu cầu kiểm thử lỗi (${response.status}).`);
    }
    if (typeof payload.activeBackend !== 'string') {
      throw new Error('Máy chủ không trả về kho database đang hoạt động.');
    }
    return { activeBackend: payload.activeBackend };
  }

  async function runCapacityTest() {
    if (
      !activeBackend ||
      activeBackend === 'switching' ||
      !nextBackendStatus?.canSwitch ||
      capacityTestConfirmation.trim() !== capacityTestConfirmPhrase ||
      capacityTestRunning ||
      mutation.isPending
    ) return;

    const startingBackend = activeBackend as DatabaseFailoverTarget;
    const nextBackendAtStart = nextBackend!;
    const controller = new AbortController();
    capacityTestController.current = controller;
    setCapacityTestRunning(true);
    setCapacityTestProgress(0);
    setCapacityTestResult(`Đang thử ${backendLabel(startingBackend)} → ${backendLabel(nextBackendAtStart)}.`);

    try {
      for (let attempt = 1; attempt <= maxCapacityTestWrites; attempt += 1) {
        if (controller.signal.aborted) {
          setCapacityTestResult(`Đã dừng theo yêu cầu sau ${attempt - 1} lượt.`);
          break;
        }

        const probeResult = await writeCapacityProbe();
        setCapacityTestProgress(attempt);
        if (probeResult.activeBackend !== startingBackend) {
          setCapacityTestResult(`Đã phát hiện chuyển kho: ${backendLabel(startingBackend)} → ${backendLabel(probeResult.activeBackend)} sau ${attempt} lượt.`);
          break;
        }
        if (attempt === maxCapacityTestWrites) {
          setCapacityTestResult(`Đã dừng an toàn sau ${maxCapacityTestWrites} lượt; Neon chưa báo chạm 100 CU-giờ nên chưa quan sát thấy chuyển kho.`);
          break;
        }

        if (controller.signal.aborted) continue;
        await new Promise<void>((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            window.clearTimeout(timer);
            controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = window.setTimeout(finish, capacityTestIntervalMs);
          controller.signal.addEventListener('abort', finish, { once: true });
        });
      }
    } catch (error) {
      setCapacityTestResult(errorText(error, 'Bài thử dừng do lỗi. Kiểm tra trạng thái database trước khi thử lại.'));
    } finally {
      capacityTestController.current = null;
      setCapacityTestRunning(false);
      setCapacityTestConfirmation('');
      await queryClient.invalidateQueries({ queryKey: getGetDatabaseFailoverStatusQueryKey() });
    }
  }

  return (
    <Modal
      title="Chuyển database dự phòng"
      onClose={mutation.isPending || capacityTestRunning ? () => undefined : onClose}
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
                        disabled={!item.canSwitch || mutation.isPending || capacityTestRunning}
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
                      disabled={!canSwitch || confirmation.trim() !== expectedConfirmation || mutation.isPending || capacityTestRunning}
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

          <section className="stack" aria-labelledby="failover-capacity-test-title" style={{ marginTop: 18 }}>
            <h2 id="failover-capacity-test-title" className="section-title">Kiểm thử ngưỡng CU</h2>
            <p className="muted small">
              Bài thử trên production tạo rồi xóa tối đa {maxCapacityTestWrites} lịch hẹn giả, cách nhau 31 giây (tối đa khoảng 31 phút). Giữ cửa sổ này mở; bài thử tự dừng khi kho active đổi, có lỗi hoặc hết lượt. Nếu chưa gần ngưỡng 100 CU-giờ, nó có thể kết thúc mà không chuyển kho.
            </p>
            {capacityTestRunning ? (
              <div className="banner soft" role="status" aria-live="polite" data-testid="status-failover-capacity-test">
                <span>Đang thử {capacityTestProgress}/{maxCapacityTestWrites} lượt.</span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => capacityTestController.current?.abort()}
                  data-testid="button-stop-failover-capacity-test"
                >
                  <Square size={14} aria-hidden="true" />Dừng
                </button>
              </div>
            ) : (
              <>
                {capacityTestResult && (
                  <div className="banner soft" role="status" data-testid="status-failover-capacity-test-result">
                    {capacityTestResult}
                  </div>
                )}
                <label className="field" htmlFor="confirm-capacity-test">
                  Nhập mật khẩu kiểm thử để xác nhận ghi thử lên production
                  <input
                    id="confirm-capacity-test"
                    type="password"
                    autoComplete="off"
                    maxLength={16}
                    value={capacityTestConfirmation}
                    onChange={(event) => setCapacityTestConfirmation(event.target.value)}
                    data-testid="input-confirm-failover-capacity-test"
                  />
                </label>
                <button
                  type="button"
                  className="btn danger"
                  disabled={
                    !nextBackendStatus?.canSwitch ||
                    capacityTestConfirmation.trim() !== capacityTestConfirmPhrase ||
                    mutation.isPending
                  }
                  onClick={() => void runCapacityTest()}
                  data-testid="button-start-failover-capacity-test"
                >
                  <Play size={14} aria-hidden="true" />
                  Chạy ghi thử liên tục
                </button>
                {!nextBackendStatus?.canSwitch && (
                  <p className="hint warn" role="status">
                    Kho liền kề tiếp theo chưa sẵn sàng; không thể chạy bài thử.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}
