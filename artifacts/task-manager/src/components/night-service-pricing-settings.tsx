import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMassageSummaryQueryKey,
  getGetMemberPayrollQueryKey,
  getGetNightServicePricingQueryKey,
  useGetNightServicePricing,
  useUpdateNightServicePricing,
} from "@workspace/api-client-react";
import { LoaderCircle, Moon } from "lucide-react";
import { ErrorBanner } from "@/components/modal";
import { formatVnd } from "@/lib/massage";

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
  const [startTime, setStartTime] = useState("22:00");
  const [endTime, setEndTime] = useState("06:00");
  const [rateDraft, setRateDraft] = useState<Record<number, { customer: string; employee: string }>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!config.data) return;
    setEnabled(config.data.enabled);
    setStartTime(config.data.startTime);
    setEndTime(config.data.endTime);
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

  function saveSettings() {
    if (!config.data || save.isPending) return;
    setError("");
    setMessage("");
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
      <p className="sub">Giờ Việt Nam, tính theo lúc ghi ca. Giá đêm thay giá thường; ca đã lưu không bị tính lại.</p>
      {config.isLoading ? <p className="muted" role="status">Đang tải giá ca đêm…</p> : config.isError ? (
        <ErrorBanner text="Không tải được cấu hình giá ca đêm." onRetry={() => void config.refetch()} />
      ) : config.data ? (
        <>
          <label className="print-setting-switch night-service-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(event) => { setEnabled(event.target.checked); setMessage(""); }}
              disabled={save.isPending}
              data-testid="switch-night-service-enabled"
            />
            <span><strong>Bật giá ca đêm</strong><small>Thay giá khách trả và tiền công theo dịch vụ.</small></span>
          </label>
          <div className="night-service-window">
            <label className="field" htmlFor="night-service-start">Bắt đầu
              <input id="night-service-start" type="time" value={startTime}
                onChange={(event) => { setStartTime(event.target.value); setMessage(""); }}
                disabled={save.isPending} data-testid="input-night-service-start" />
            </label>
            <label className="field" htmlFor="night-service-end">Kết thúc
              <input id="night-service-end" type="time" value={endTime}
                onChange={(event) => { setEndTime(event.target.value); setMessage(""); }}
                disabled={save.isPending} data-testid="input-night-service-end" />
            </label>
          </div>
          {config.data.rates.length ? (
            <div className="night-service-rates" aria-label="Giá ca đêm cho từng dịch vụ">
              {config.data.rates.map((rate) => {
                const draft = rateDraft[rate.serviceTypeId] ?? { customer: "", employee: "" };
                return (
                  <fieldset className="night-service-rate-row" key={rate.serviceTypeId}>
                    <legend>{rate.serviceName}</legend>
                    <p className="night-service-base-rates">
                      Giá thường: khách {formatVnd(rate.standardCustomerHourlyRate)} / giờ
                      {" · "}công {formatVnd(rate.standardEmployeeHourlyRate)} / giờ
                    </p>
                    <label className="field" htmlFor={`night-customer-${rate.serviceTypeId}`}>Khách trả / giờ
                      <input id={`night-customer-${rate.serviceTypeId}`} type="number" inputMode="numeric" min="1" max="10000000" step="1000"
                        value={draft.customer}
                        onChange={(event) => { setRateDraft((previous) => ({ ...previous, [rate.serviceTypeId]: { ...draft, customer: event.target.value } })); setMessage(""); }}
                        disabled={save.isPending}
                        data-testid={`input-night-customer-rate-${rate.serviceTypeId}`} />
                    </label>
                    <label className="field" htmlFor={`night-employee-${rate.serviceTypeId}`}>Tiền công / giờ
                      <input id={`night-employee-${rate.serviceTypeId}`} type="number" inputMode="numeric" min="1" max="10000000" step="1000"
                        value={draft.employee}
                        onChange={(event) => { setRateDraft((previous) => ({ ...previous, [rate.serviceTypeId]: { ...draft, employee: event.target.value } })); setMessage(""); }}
                        disabled={save.isPending}
                        data-testid={`input-night-employee-rate-${rate.serviceTypeId}`} />
                    </label>
                  </fieldset>
                );
              })}
            </div>
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
    </section>
  );
}
