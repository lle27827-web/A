const QUICK_HOURS = [0, 1, 2, 3] as const;
const QUICK_MINUTES = [0, 15, 30, 45] as const;

export function DurationInputs({ hours, minutes, onHoursChange, onMinutesChange, hourId, minuteId, prefix, describedBy }: {
  hours: string;
  minutes: string;
  onHoursChange: (value: string) => void;
  onMinutesChange: (value: string) => void;
  hourId: string;
  minuteId: string;
  prefix: string;
  describedBy?: string;
}) {
  return (
    <div className="duration-input-row">
      <div className="field duration-field">
        <label htmlFor={hourId}>Số giờ</label>
        <input id={hourId} type="number" inputMode="numeric" min={0} max={24} step={1} value={hours}
          onChange={(event) => onHoursChange(event.target.value)} required
          aria-describedby={describedBy} data-testid={`input-${prefix}-hours`} />
        <div className="duration-quick-row" role="group" aria-label="Chọn nhanh số giờ">
          {QUICK_HOURS.map((hour) => (
            <button key={hour} type="button" className={`chip pad ${hours === String(hour) ? 'active' : ''}`}
              onClick={() => onHoursChange(String(hour))}
              data-testid={`button-${prefix}-quick-hours-${hour}`}>{hour} giờ</button>
          ))}
        </div>
      </div>
      <div className="field duration-field">
        <label htmlFor={minuteId}>Số phút</label>
        <input id={minuteId} type="number" inputMode="numeric" min={0} max={59} step={1} value={minutes}
          onChange={(event) => onMinutesChange(event.target.value)}
          aria-describedby={describedBy} data-testid={`input-${prefix}-minutes`} />
        <div className="duration-quick-row" role="group" aria-label="Chọn nhanh số phút">
          {QUICK_MINUTES.map((minute) => (
            <button key={minute} type="button" className={`chip pad ${minutes === String(minute) ? 'active' : ''}`}
              onClick={() => onMinutesChange(String(minute))}
              data-testid={`button-${prefix}-quick-minutes-${minute}`}>{minute} phút</button>
          ))}
        </div>
      </div>
    </div>
  );
}
