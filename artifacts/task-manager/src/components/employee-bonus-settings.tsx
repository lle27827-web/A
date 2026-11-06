import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetEmployeeBonusConfigQueryKey,
  useGetEmployeeBonusConfig,
  useUpdateEmployeeBonusConfig,
} from '@workspace/api-client-react';
import { BadgeDollarSign, LoaderCircle } from 'lucide-react';
import { ErrorBanner } from '@/components/modal';
import { formatVnd } from '@/lib/massage';

function rateKey(memberId: number, serviceTypeId: number) {
  return `${memberId}:${serviceTypeId}`;
}

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
  }
  return 'Không lưu được bảng thưởng. Hãy thử lại.';
}

export function EmployeeBonusSettings({ open, isOwner }: { open: boolean; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const config = useGetEmployeeBonusConfig({
    query: {
      queryKey: getGetEmployeeBonusConfigQueryKey(),
      enabled: open && isOwner,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  });
  const save = useUpdateEmployeeBonusConfig();
  const [enabled, setEnabled] = useState(false);
  const [thresholdHours, setThresholdHours] = useState('');
  const [memberId, setMemberId] = useState('');
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!config.data) return;
    setEnabled(config.data.enabled);
    setThresholdHours(config.data.thresholdMinutes > 0
      ? String(config.data.thresholdMinutes / 60)
      : '');
    setRateDraft(Object.fromEntries(config.data.rates.map((rate) => [
      rateKey(rate.memberId, rate.serviceTypeId),
      String(rate.hourlyRate),
    ])));
    setMemberId((current) => config.data.members.some((member) => String(member.id) === current)
      ? current
      : String(config.data.members[0]?.id ?? ''));
    setError('');
    setMessage('');
  }, [config.data]);

  const selectedMemberId = Number(memberId);
  const selectedMember = config.data?.members.find((member) => member.id === selectedMemberId);
  const selectedRates = useMemo(
    () => config.data?.rates.filter((rate) => rate.memberId === selectedMemberId) ?? [],
    [config.data?.rates, selectedMemberId],
  );
  const currentRateByService = new Map(selectedRates.map((rate) => [rate.serviceTypeId, rate.hourlyRate]));

  function saveSettings() {
    if (!config.data || save.isPending) return;
    setError('');
    setMessage('');
    const hours = thresholdHours.trim() === '' ? 0 : Number(thresholdHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 744) {
      setError('Nhập số giờ từ 0 đến 744.');
      return;
    }
    const thresholdMinutes = Math.round(hours * 60);
    if (enabled && thresholdMinutes < 1) {
      setError('Nhập ngưỡng giờ lớn hơn 0 trước khi bật thưởng tiền công.');
      return;
    }

    let rateValidationError = '';
    const rateUpdates = selectedMember ? config.data.services.flatMap((service) => {
      const key = rateKey(selectedMember.id, service.id);
      const value = rateDraft[key]?.trim() ?? '';
      const oldRate = currentRateByService.get(service.id) ?? null;
      const nextRate = value === '' ? null : Number(value);
      if (nextRate !== null && (!Number.isInteger(nextRate) || nextRate <= service.hourlyRate || nextRate > 10_000_000)) {
        rateValidationError = `Tiền công thưởng của ${service.name} phải cao hơn ${formatVnd(service.hourlyRate)}.`;
        return [];
      }
      return nextRate === oldRate ? [] : [{
        memberId: selectedMember.id,
        serviceTypeId: service.id,
        hourlyRate: nextRate,
      }];
    }) : [];
    if (rateValidationError) {
      setError(rateValidationError);
      return;
    }
    save.mutate({
      data: { enabled, thresholdMinutes, rates: rateUpdates },
    }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetEmployeeBonusConfigQueryKey() });
        setMessage('Đã lưu. Ca đã ghi trước đó giữ nguyên tiền công.');
      },
      onError: (saveError) => setError(errorText(saveError)),
    });
  }

  if (!isOwner) return null;

  return (
    <section className="employee-bonus-settings" aria-labelledby="employee-bonus-title" data-testid="section-employee-bonus-settings">
      <h3 id="employee-bonus-title"><BadgeDollarSign size={16} aria-hidden="true" />Thưởng tiền công theo giờ tháng</h3>
      <p className="sub">
        Cộng giờ của mọi dịch vụ trong tháng. Ca chạm ngưỡng dùng mức thường; ca sau đó mới dùng mức thưởng.
        Tiền công các ca đã ghi không bị tính lại.
      </p>
      {config.isLoading ? <p className="muted" role="status">Đang tải bảng thưởng…</p> : config.isError ? (
        <ErrorBanner text="Không tải được cấu hình thưởng tiền công." onRetry={() => void config.refetch()} />
      ) : config.data ? (
        <>
          <label className="print-setting-switch employee-bonus-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              onChange={(event) => { setEnabled(event.target.checked); setMessage(''); }}
              disabled={save.isPending}
              data-testid="switch-employee-bonus-enabled"
            />
            <span><strong>Bật thưởng tiền công</strong><small>Chỉ thay đổi tiền công nhân viên, không đổi giá khách trả.</small></span>
          </label>
          <label className="field employee-bonus-threshold" htmlFor="employee-bonus-threshold">
            Ngưỡng tổng giờ trong tháng
            <div className="employee-bonus-threshold-input">
              <input
                id="employee-bonus-threshold"
                type="number"
                inputMode="decimal"
                min="0"
                max="744"
                step="0.5"
                value={thresholdHours}
                onChange={(event) => { setThresholdHours(event.target.value); setMessage(''); }}
                disabled={save.isPending}
                placeholder="Ví dụ: 40"
                data-testid="input-employee-bonus-threshold"
              />
              <span>giờ</span>
            </div>
          </label>

          {config.data.members.length > 0 && config.data.services.length > 0 ? (
            <>
              <label className="field" htmlFor="employee-bonus-member">Mức tiền công thưởng cho nhân viên
                <select
                  id="employee-bonus-member"
                  value={memberId}
                  onChange={(event) => { setMemberId(event.target.value); setMessage(''); }}
                  disabled={save.isPending}
                  data-testid="select-employee-bonus-member"
                >
                  {config.data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
              {selectedMember && (
                <div className="employee-bonus-rates" aria-label={`Tiền công thưởng của ${selectedMember.name}`}>
                  {config.data.services.map((service) => {
                    const key = rateKey(selectedMember.id, service.id);
                    return (
                      <label className="employee-bonus-rate-row" key={service.id}>
                        <span className="employee-bonus-service">
                          <strong>{service.name}</strong>
                          <small>Hiện tại {formatVnd(service.hourlyRate)} / giờ</small>
                        </span>
                        <span className="employee-bonus-rate-input">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={service.hourlyRate + 1}
                            max="10000000"
                            step="1000"
                            value={rateDraft[key] ?? ''}
                            onChange={(event) => {
                              setRateDraft((previous) => ({ ...previous, [key]: event.target.value }));
                              setMessage('');
                            }}
                            disabled={save.isPending}
                            aria-label={`Tiền công thưởng ${service.name} cho ${selectedMember.name}`}
                            placeholder="Để trống nếu không thưởng"
                            data-testid={`input-employee-bonus-rate-${service.id}`}
                          />
                          <small>đồng / giờ</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <p className="employee-bonus-empty">Cần có ít nhất một nhân viên và một dịch vụ để cài mức thưởng.</p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button type="button" className="btn primary employee-bonus-save" onClick={saveSettings}
            disabled={save.isPending || config.isLoading} data-testid="button-save-employee-bonus">
            {save.isPending && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
            Lưu bảng thưởng
          </button>
        </>
      ) : null}
    </section>
  );
}
