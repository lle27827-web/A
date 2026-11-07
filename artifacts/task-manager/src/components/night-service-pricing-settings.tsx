import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMassageSummaryQueryKey,
  getGetMemberPayrollQueryKey,
  getGetNightServicePricingQueryKey,
  useGetNightServicePricing,
  useUpdateNightServicePricing,
} from "@workspace/api-client-react";
import { Check, ChevronRight, LoaderCircle, Moon } from "lucide-react";
import { ErrorBanner, Modal } from "@/components/modal";
import { formatVnd } from "@/lib/massage";

type RateDraft = { customer: string; employee: string };
type ClockParts = { hour: string; minute: string };

function splitClock(value: string): ClockParts {
  const [hour = "0", minute = "0"] = value.split(":");
  return { hour: String(Number(hour)), minute: String(Number(minute)) };
}

function joinClock(hour: string, minute: string): string | null {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const hours = Number(hour);
  const minutes = Number(minute);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getApiError(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === "string") return message;
    }
  }
  return "Không lưu được giá ca đêm. Hãy thử lại.";
}

function parseRate(value: string) {
  if (!value.trim()) return null;
  const rate = Number(value);
  return Number.isSafeInteger(rate) ? rate : Number.NaN;
}

function displayNightRate(value: string) {
  const rate = parseRate(value);
  if (rate === null || !Number.isSafeInteger(rate) || rate < 1 || rate > 10_000_000) return "chưa cài";
  return `${formatVnd(rate)} / giờ`;
}

export function NightServicePricingSettings({ open, isOwner }: { open: boolean; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const config = useGetNightServicePricing({
    query: {
      queryKey: getGetNightServicePricingQueryKey(),
      enabled: open && isOwner,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const save = useUpdateNightServicePricing();
  const [enabled, setEnabled] = useState(false);
  const [start, setStart] = useState<ClockParts>({ hour: "22", minute: "0" });
  const [end, setEnd] = useState<ClockParts>({ hour: "6", minute: "0" });
  const [rateDraft, setRateDraft] = useState<Record<number, RateDraft>>({});
  const [editingServiceTypeId, setEditingServiceTypeId] = useState<number | null>(null);
  const [rateEditorError, setRateEditorError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const draftTouched = useRef(false);

  useEffect(() => {
    if (!config.data || draftTouched.current) return;
    setEnabled(config.data.enabled);
    setStart(splitClock(config.data.startTime));
    setEnd(splitClock(config.data.endTime));
    setRateDraft(Object.fromEntries(config.data.rates.map((rate) => [
      rate.serviceTypeId,
      {
        customer: rate.customerHourlyRate === null ? "" : String(rate.customerHourlyRate),
        employee: rate.employeeHourlyRate === null ? "" : String(rate.employeeHourlyRate),
      },
    ])));
    setError("");
    setMessage("");
  }, [config.data]);

  const editingRate = config.data?.rates.find((rate) => rate.serviceTypeId === editingServiceTypeId);
  const editingDraft = editingRate
    ? rateDraft[editingRate.serviceTypeId] ?? { customer: "", employee: "" }
    : { customer: "", employee: "" };

  function updateRateDraft(serviceTypeId: number, key: keyof RateDraft, value: string) {
    draftTouched.current = true;
    setRateDraft((previous) => ({
      ...previous,
      [serviceTypeId]: {
        ...(previous[serviceTypeId] ?? { customer: "", employee: "" }),
        [key]: value,
      },
    }));
    setMessage("");
    setRateEditorError("");
  }

  function finishRateEdit() {
    if (!editingRate) return;
    const customer = parseRate(editingDraft.customer);
    const employee = parseRate(editingDraft.employee);
    const bothBlank = !editingDraft.customer.trim() && !editingDraft.employee.trim();
    if (!bothBlank && (customer === null || employee === null)) {
      setRateEditorError("Hãy nhập cả giá khách trả và tiền công, hoặc để trống cả hai.");
      return;
    }
    if (!bothBlank && [customer, employee].some((value) =>
      value === null || !Number.isSafeInteger(value) || value < 1 || value > 10_000_000,
    )) {
      setRateEditorError("Mỗi mức giá phải là số nguyên từ 1 đến 10.000.000 đồng/giờ.");
      return;
    }
    if (bothBlank) {
      draftTouched.current = true;
      setRateDraft((previous) => ({
        ...previous,
        [editingRate.serviceTypeId]: { customer: "", employee: "" },
      }));
    }
    setRateEditorError("");
    setEditingServiceTypeId(null);
  }

  function clearRateEdit() {
    if (!editingRate) return;
    draftTouched.current = true;
    setRateDraft((previous) => ({
      ...previous,
      [editingRate.serviceTypeId]: { customer: "", employee: "" },
    }));
    setRateEditorError("");
    setMessage("");
    setEditingServiceTypeId(null);
  }

  function saveSettings() {
    if (!config.data || save.isPending) return;
    setError("");
    setMessage("");
    const startTime = joinClock(start.hour, start.minute);
    const endTime = joinClock(end.hour, end.minute);
    if (!startTime || !endTime) return setError("Nhập giờ từ 0 đến 23 và phút từ 0 đến 59.");
    if (startTime === endTime) return setError("Giờ bắt đầu và kết thúc không được trùng nhau.");

    const rates = config.data.rates.map((rate) => {
      const draft = rateDraft[rate.serviceTypeId] ?? { customer: "", employee: "" };
      return {
        serviceTypeId: rate.serviceTypeId,
        customerHourlyRate: parseRate(draft.customer),
        employeeHourlyRate: parseRate(draft.employee),
      };
    });
    const invalid = rates.find((rate) =>
      [rate.customerHourlyRate, rate.employeeHourlyRate].some((value) =>
        value !== null && (!Number.isInteger(value) || value < 1 || value > 10_000_000),
      ),
    );
    if (invalid) return setError("Mỗi mức giá phải là số nguyên từ 1 đến 10.000.000 đồng/giờ.");
    const missing = rates.find((rate) => rate.customerHourlyRate === null || rate.employeeHourlyRate === null);
    if (enabled && missing) {
      const serviceName = config.data.rates.find((rate) => rate.serviceTypeId === missing.serviceTypeId)?.serviceName;
      return setError(`Hãy nhập cả giá khách trả và tiền công cho ${serviceName ?? "mỗi dịch vụ"} trước khi bật.`);
    }

    save.mutate({
      data: { enabled, startTime, endTime, rates },
    }, {
      onSuccess: async () => {
        draftTouched.current = false;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetNightServicePricingQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMassageSummaryQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetMemberPayrollQueryKey() }),
        ]);
        setMessage("Đã lưu giá ca đêm. Các ca đã ghi trước đó giữ nguyên giá.");
      },
      onError: (saveError) => setError(getApiError(saveError)),
    });
  }

  if (!isOwner) return null;

  return (
    <section className="night-service-settings" aria-labelledby="night-service-settings-title" data-testid="section-night-service-settings">
      <h3 id="night-service-settings-title"><Moon size={16} aria-hidden="true" />Dịch vụ ca đêm muộn</h3>
      <p className="sub">Giá ca đêm thay giá thường trong khung giờ đã đặt.</p>
      {config.isLoading ? <p className="muted" role="status">Đang tải giá ca đêm…</p> : config.isError ? (
        <ErrorBanner text="Không tải được cấu hình giá ca đêm." onRetry={() => void config.refetch()} />
      ) : config.data ? (
        <>
          <label className="print-setting-switch night-service-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(event) => { draftTouched.current = true; setEnabled(event.target.checked); setMessage(""); }}
              disabled={save.isPending}
              data-testid="switch-night-service-enabled"
            />
            <span><strong>Bật giá ca đêm</strong><small>Thay giá khách trả và tiền công theo dịch vụ.</small></span>
          </label>
          <div className="night-service-window">
            <ClockInputs id="night-service-start" title="Bắt đầu" value={start}
              onChange={(value) => { draftTouched.current = true; setStart(value); setMessage(""); }} disabled={save.isPending} />
            <ClockInputs id="night-service-end" title="Kết thúc" value={end}
              onChange={(value) => { draftTouched.current = true; setEnd(value); setMessage(""); }} disabled={save.isPending} />
          </div>
          {config.data.rates.length ? (
            <ul className="emp-list night-service-rates" aria-label="Giá ca đêm cho từng dịch vụ">
              {config.data.rates.map((rate) => {
                const draft = rateDraft[rate.serviceTypeId] ?? { customer: "", employee: "" };
                const configured = [draft.customer, draft.employee].every((value) => {
                  const parsed = parseRate(value);
                  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 10_000_000;
                });
                return (
                  <li key={rate.serviceTypeId}>
                    <button type="button" className="emp-row night-service-rate-item"
                      onClick={() => { setRateEditorError(""); setEditingServiceTypeId(rate.serviceTypeId); }}
                      disabled={save.isPending}
                      data-testid={`row-night-service-${rate.serviceTypeId}`}>
                      <span className="grow">
                        <strong>{rate.serviceName}</strong>
                        <span className="muted mono">Giá thường: khách {formatVnd(rate.standardCustomerHourlyRate)} · công {formatVnd(rate.standardEmployeeHourlyRate)} / giờ</span>
                        <span className="muted mono">Ca đêm: khách {displayNightRate(draft.customer)} · công {displayNightRate(draft.employee)}</span>
                      </span>
                      <span className="night-rate-indicator" aria-label={configured ? "Đã cài giá ca đêm" : "Chưa cài giá ca đêm"}>
                        {configured ? <Check size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">Thêm ít nhất một dịch vụ trước khi cài giá ca đêm.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button type="button" className="btn primary night-service-save" onClick={saveSettings}
            disabled={save.isPending || config.isLoading} data-testid="button-save-night-service-pricing">
            {save.isPending && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
            Lưu giá ca đêm
          </button>
        </>
      ) : null}
      {editingRate && (
        <Modal title={`Giá ca đêm · ${editingRate.serviceName}`}
          onClose={() => { setEditingServiceTypeId(null); setRateEditorError(""); }}
          testId={`dialog-night-service-rate-${editingRate.serviceTypeId}`}>
          <p className="night-service-base-rates">
            Giá thường: khách {formatVnd(editingRate.standardCustomerHourlyRate)} · công {formatVnd(editingRate.standardEmployeeHourlyRate)} / giờ
          </p>
          <label className="field" htmlFor={`night-customer-${editingRate.serviceTypeId}`}>Khách trả / giờ
            <input id={`night-customer-${editingRate.serviceTypeId}`} type="number" inputMode="numeric" min="1" max="10000000" step="1000"
              value={editingDraft.customer}
              onChange={(event) => updateRateDraft(editingRate.serviceTypeId, "customer", event.target.value)}
              disabled={save.isPending} data-testid={`input-night-customer-rate-${editingRate.serviceTypeId}`} />
          </label>
          <label className="field" htmlFor={`night-employee-${editingRate.serviceTypeId}`}>Tiền công / giờ
            <input id={`night-employee-${editingRate.serviceTypeId}`} type="number" inputMode="numeric" min="1" max="10000000" step="1000"
              value={editingDraft.employee}
              onChange={(event) => updateRateDraft(editingRate.serviceTypeId, "employee", event.target.value)}
              disabled={save.isPending} data-testid={`input-night-employee-rate-${editingRate.serviceTypeId}`} />
          </label>
          {rateEditorError && <p className="form-error" role="alert">{rateEditorError}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn ghost" onClick={clearRateEdit} disabled={save.isPending}>Bỏ giá ca đêm</button>
            <button type="button" className="btn ghost" onClick={() => setEditingServiceTypeId(null)} disabled={save.isPending}>Hủy</button>
            <button type="button" className="btn primary" onClick={finishRateEdit} disabled={save.isPending}>Xong</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ClockInputs({ id, title, value, onChange, disabled }: {
  id: string;
  title: string;
  value: ClockParts;
  onChange: (value: ClockParts) => void;
  disabled: boolean;
}) {
  return (
    <div className="night-clock-field" role="group" aria-label={title}>
      <span className="night-clock-title">{title}</span>
      <div className="night-clock-inputs">
        <label className="field" htmlFor={`${id}-hour`}>Giờ
          <input id={`${id}-hour`} type="number" inputMode="numeric" min="0" max="23" step="1"
            value={value.hour} onChange={(event) => onChange({ ...value, hour: event.target.value })}
            disabled={disabled} data-testid={`input-${id}-hour`} />
        </label>
        <span className="night-clock-separator" aria-hidden="true">:</span>
        <label className="field" htmlFor={`${id}-minute`}>Phút
          <input id={`${id}-minute`} type="number" inputMode="numeric" min="0" max="59" step="1"
            value={value.minute} onChange={(event) => onChange({ ...value, minute: event.target.value })}
            disabled={disabled} data-testid={`input-${id}-minute`} />
        </label>
      </div>
    </div>
  );
}
