import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDatabaseFailoverStatusQueryKey,
  getGetDatabaseStorageStatusQueryKey,
  useGetDatabaseStorageStatus,
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
  independent: 'Kho độc lập',
};

const capacityLabels: Record<string, string> = {
  available: 'Sẵn sàng',
  full: 'Đã chạm giới hạn',
  unavailable: 'Không truy cập được',
  unknown: 'Chưa xác minh',
  not_checked: 'Chưa kiểm tra',
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
  const storageStatus = useGetDatabaseStorageStatus({
    query: {
      queryKey: getGetDatabaseStorageStatusQueryKey(),
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
  const capacityTestBlocker = activeBackend === 'switching'
    ? 'Đang có thao tác chuyển database; hãy tải lại trạng thái.'
    : !activeBackend
      ? 'Chưa tải được trạng thái database đang hoạt động.'
      : !nextBackend
        ? `${backendLabel(activeBackend)} là kho cuối trong chuỗi tự động; không có kho tiếp theo để thử.`
        : !nextBackendStatus
          ? `Chưa tải được trạng thái ${backendLabel(nextBackend)}. Hãy tải lại trạng thái.`
          : !nextBackendStatus.configured || !nextBackendStatus.canSwitch
            ? `${backendLabel(nextBackend)} chưa sẵn sàng: ${nextBackendStatus.message}`
            : null;
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
          await queryClient.invalidateQueries({
            queryKey: getGetDatabaseStorageStatusQueryKey(),
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
      capacityTestBlocker ||
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
      await queryClient.invalidateQueries({ queryKey: getGetDatabaseStorageStatusQueryKey() });
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
            <span>
              Database hoạt động: <strong>{backendLabel(status.data?.activeBackend)}</strong>
              <br />
              Bộ điều phối: <strong>{backendLabel(status.data?.coordinatorBackend)}</strong>
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void status.refetch()}
              disabled={status.isFetching}
              aria-label="Tải lại trạng thái database và replication"
              data-testid="button-refresh-database-failover-status"
            >
              {status.isFetching
                ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
                : <RotateCw size={14} aria-hidden="true" />}
              Tải lại
            </button>
          </div>

          <section className="stack" aria-labelledby="storage-routing-status-title" style={{ marginTop: 14 }}>
            <div className="dialog-head">
              <h2 id="storage-routing-status-title" className="section-title">Trạng thái chuyển kho</h2>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void storageStatus.refetch()}
                disabled={storageStatus.isFetching}
                aria-label="Tải lại trạng thái định tuyến bốn kho"
                data-testid="button-refresh-storage-routing-status"
              >
                {storageStatus.isFetching
                  ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  : <RotateCw size={14} aria-hidden="true" />}
                Tải lại
              </button>
            </div>
            {storageStatus.isLoading ? (
              <Skeleton rows={2} label="Đang kiểm tra định tuyến và trạng thái bốn kho" />
            ) : storageStatus.isError ? (
              <ErrorBanner text={errorText(storageStatus.error, 'Không tải được trạng thái định tuyến.')} onRetry={() => void storageStatus.refetch()} />
            ) : storageStatus.data ? (
              <>
                <div className="banner soft" role="status" data-testid="status-storage-routing-mode">
                  <Database size={15} aria-hidden="true" />
                  <span>
                    Chế độ: <strong>{storageStatus.data.enabled ? 'Phân vùng ghi tiến về phía trước' : 'Failover replication hiện có'}</strong>
                    <br />
                    Bộ điều phối phân vùng: <strong>{backendLabel(storageStatus.data.coordinatorBackend)}</strong>
                    {storageStatus.data.enabled && (
                      <>
                        <br />
                        Con trỏ ghi: <strong>{backendLabel(storageStatus.data.writeCursor ?? undefined)}</strong>
                      </>
                    )}
                  </span>
                </div>
                <div className="stack" aria-label="Dung lượng và trạng thái bốn kho">
                  {storageStatus.data.stores.map((store) => (
                    <div className="banner soft" key={store.backend} data-testid={`storage-routing-${store.backend}`}>
                      <span>
                        <strong>{backendLabel(store.backend)}</strong>
                        {' · '}{store.configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                        {' · '}{capacityLabels[store.capacity] ?? store.capacity}
                        {store.eventJournalReady === true && ' · Nhật ký sẵn sàng'}
                        {store.eventJournalReady === false && ' · Thiếu nhật ký'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="muted small">
                  Ngưỡng phân vùng: {Number(storageStatus.data.storageLimitBytes) / 1_000_000_000} GB hoặc {storageStatus.data.computeLimitHours} CU-giờ.
                </p>
                {storageStatus.data.blockers.length > 0 && (
                  <ul className="hint warn" role="status" data-testid="storage-routing-blockers">
                    {storageStatus.data.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}
                  </ul>
                )}
                {storageStatus.data.enabled && storageStatus.data.readsRequireAllStores && (
                  <p className="hint warn" role="note">
                    Lượt đọc hiện cần DB1 cùng nhật ký ở cả bốn kho. Nếu một kho ngắt kết nối, lượt đọc có thể bị chặn dù ghi mới đã chuyển tiếp.
                  </p>
                )}
              </>
            ) : null}
          </section>

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
              {status.data?.coordinatorBackend === 'database_url_4' && (
                <p className="hint warn" role="note">
                  DB4 đang điều phối trạng thái và là điểm lỗi đơn; nếu DB4 đầy hoặc mất kết nối, việc chuyển kho sẽ bị chặn.
                </p>
              )}

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
                    Boolean(capacityTestBlocker) ||
                    capacityTestConfirmation.trim() !== capacityTestConfirmPhrase ||
                    mutation.isPending
                  }
                  onClick={() => void runCapacityTest()}
                  data-testid="button-start-failover-capacity-test"
                >
                  <Play size={14} aria-hidden="true" />
                  Chạy ghi thử liên tục
                </button>
                {capacityTestBlocker && (
                  <p className="hint warn" role="status">
                    {capacityTestBlocker}
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
