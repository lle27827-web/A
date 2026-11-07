import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAppointmentStaffActivityQueryKey,
  getListAppointmentsQueryKey, getListTreatmentCardsQueryKey, useCreateAppointment, useCreateServiceSession, useDeleteAppointment,
  useListAppointmentStaffActivity, useListAppointments, useUpdateAppointment,
  useListTreatmentCards, useUpdateAppointmentStaffActivity,
} from '@workspace/api-client-react';
import type { Appointment, AppointmentInput, AppointmentStaffActivity, ServiceSessionInput } from '@workspace/api-client-react';
import { BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Coffee, LoaderCircle, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { useShell } from '@/components/app-shell';
import { useLocation, useSearch } from 'wouter';
import { SessionDialog } from '@/components/session-dialog';
import { phoneCallHref } from '@/lib/phone';
import { errorText, useRefreshMassage } from '@/lib/massage';
import { printServiceSession, reservePrintWindow } from '@/lib/printing';

type AppointmentDraft = {
  customerName: string;
  phone: string;
  date: string;
  hour: string;
  minute: string;
  memberId: string;
  legacyRequest: string;
  note: string;
};

const blankDraft = (): AppointmentDraft => {
  const scheduledAt = toLocalInput(new Date(Date.now() + 60 * 60 * 1000));
  return {
    customerName: '',
    phone: '',
    date: scheduledAt.slice(0, 10),
    hour: scheduledAt.slice(11, 13),
    minute: scheduledAt.slice(14, 16),
    memberId: '',
    legacyRequest: '',
    note: '',
  };
};

function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromAppointment(appointment: Appointment): AppointmentDraft {
  const scheduledAt = toLocalInput(new Date(appointment.scheduledAt));
  return {
    customerName: appointment.customerName,
    phone: appointment.phone,
    date: scheduledAt.slice(0, 10),
    hour: scheduledAt.slice(11, 13),
    minute: scheduledAt.slice(14, 16),
    memberId: appointment.memberId === null ? '' : String(appointment.memberId),
    legacyRequest: appointment.request ?? '',
    note: appointment.note ?? '',
  };
}

function formatAppointmentDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function formatActivityEnd(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatAppointmentTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function formatNextAppointment(value: string) {
  const dateKey = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const appointmentDate = dateKey(new Date(value));
  const today = dateKey(new Date());
  const time = formatAppointmentTime(value);
  if (appointmentDate === today) return time;
  const date = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
  return `${date} lúc ${time}`;
}

function activityDetails(activity: AppointmentStaffActivity) {
  const details: { kind: 'state' | 'detail' | 'appointment'; text: string }[] = [];
  if (activity.state === 'working') {
    details.push({ kind: 'state', text: 'Đang làm' });
    if (activity.serviceType) details.push({ kind: 'detail', text: activity.serviceType });
    if (activity.endsAt) {
      details.push({ kind: 'detail', text: `Dự kiến ra lúc ${formatActivityEnd(activity.endsAt)}` });
    } else {
      details.push({ kind: 'detail', text: 'Chưa xác định giờ dự kiến xong' });
    }
  } else {
    details.push({ kind: 'state', text: activity.state === 'off' ? 'Đang nghỉ' : 'Đang rảnh' });
    if (activity.lastFinishedAt) {
      details.push({
        kind: 'detail',
        text: `Ca gần nhất dự kiến xong lúc ${formatActivityEnd(activity.lastFinishedAt)}`,
      });
    } else {
      details.push({ kind: 'detail', text: 'Chưa có giờ kết thúc gần đây' });
    }
  }
  if (activity.nextAppointmentAt) {
    const appointmentInfo = [
      `Lịch hẹn lúc ${formatNextAppointment(activity.nextAppointmentAt)}`,
      activity.nextAppointmentCustomerName ? `Khách: ${activity.nextAppointmentCustomerName}` : null,
      activity.nextAppointmentRequest ? `Yêu cầu: ${activity.nextAppointmentRequest}` : null,
      activity.nextAppointmentNote ? `Ghi chú: ${activity.nextAppointmentNote}` : null,
    ].filter((value): value is string => value !== null);
    details.push({
      kind: 'appointment',
      text: appointmentInfo.join(' · '),
    });
  }
  return details;
}

export default function AppointmentsPage() {
  const {
    permissions, members, canEditEmployees, canEditCards, period, notify, printPreferences,
  } = useShell();
  const [, navigate] = useLocation();
  const search = useSearch();
  const canEdit = permissions.editAppointments;
  const cache = useQueryClient();
  const appointments = useListAppointments({
    query: {
      queryKey: getListAppointmentsQueryKey(),
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  });
  const staffActivity = useListAppointmentStaffActivity({
    query: {
      queryKey: getListAppointmentStaffActivityQueryKey(),
      refetchInterval: 30_000,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  });
  const create = useCreateAppointment();
  const update = useUpdateAppointment();
  const updateActivity = useUpdateAppointmentStaffActivity();
  const remove = useDeleteAppointment();
  const createSession = useCreateServiceSession();
  const refreshMassage = useRefreshMassage();
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [attendanceMemberId, setAttendanceMemberId] = useState<number | null>(null);
  const [attendanceError, setAttendanceError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const cards = useListTreatmentCards(undefined, {
    query: {
      queryKey: getListTreatmentCardsQueryKey(),
      enabled: attendanceMemberId !== null && canEditEmployees && canEditCards,
    },
  });
  const records = useMemo(
    () => [...(appointments.data ?? [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [appointments.data],
  );
  const busy = create.isPending || update.isPending;

  function openAttendance(memberId: number) {
    if (!canEditEmployees || !members.some((member) => member.id === memberId)) return;
    setAttendanceError('');
    setAttendanceMemberId(memberId);
  }

  function submitAttendance(input: ServiceSessionInput) {
    if (!canEditEmployees || attendanceMemberId === null || input.memberId !== attendanceMemberId) return;
    setAttendanceError('');
    const printWindow = printPreferences.autoPrintServiceSessions ? reservePrintWindow() : null;
    createSession.mutate({ data: input }, {
      onSuccess: (saved) => {
        refreshMassage();
        void cache.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        setAttendanceMemberId(null);
        if (printPreferences.autoPrintServiceSessions) {
          const printed = printServiceSession(printWindow, saved, printPreferences);
          notify(printed
            ? 'Đã chấm công và mở phiếu in.'
            : 'Đã chấm công. Trình duyệt chặn cửa sổ in; hãy cho phép cửa sổ bật lên để tự in.');
        } else {
          notify(`Đã chấm công cho ${saved.employeeName}.`);
        }
      },
      onError: (error) => {
        if (printWindow && !printWindow.closed) printWindow.close();
        setAttendanceError(errorText(error));
      },
    });
  }

  function closeForm() {
    if (busy) return;
    setDraft(null);
    setEditing(null);
    setFormError('');
  }

  function openNew() {
    setNotice('');
    setFormError('');
    setEditing(null);
    setDraft(blankDraft());
  }

  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('shortcutAction') !== 'new-appointment') return;
    params.delete('shortcutAction');
    const remaining = params.toString();
    navigate(`/appointments${remaining ? `?${remaining}` : ''}`, { replace: true });
    if (canEdit) openNew();
  }, [canEdit, navigate, search]);

  function openEdit(appointment: Appointment) {
    setNotice('');
    setFormError('');
    setEditing(appointment);
    setDraft(fromAppointment(appointment));
  }

  function setEmployeeOff(activity: AppointmentStaffActivity) {
    const state = activity.state === 'off' ? 'available' : 'off';
    updateActivity.mutate({ memberId: activity.memberId, data: { state } }, {
      onSuccess: (updated) => {
        void cache.invalidateQueries({ queryKey: getListAppointmentStaffActivityQueryKey() });
        setFormError('');
        setNotice(updated.state === 'off'
          ? `Đã đánh dấu ${updated.employeeName} nghỉ hôm nay.`
          : `${updated.employeeName} đã trở lại trạng thái sẵn sàng.`);
      },
      onError: (error) => setFormError(errorText(error)),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const customerName = draft.customerName.trim();
    const phone = draft.phone.trim();
    if (customerName.length > 160) return setFormError('Tên khách không được dài quá 160 ký tự.');
    if (phone.length > 40) return setFormError('Số điện thoại không được dài quá 40 ký tự.');
    const hour = Number(draft.hour);
    const minute = Number(draft.minute);
    if (!draft.date || !Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return setFormError('Chọn ngày, giờ và phút hẹn hợp lệ.');
    }
    const scheduled = new Date(`${draft.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    if (Number.isNaN(scheduled.getTime())) return setFormError('Chọn ngày và giờ hẹn hợp lệ.');
    if (draft.note.trim().length > 2000) return setFormError('Ghi chú không được dài quá 2.000 ký tự.');
    const data: AppointmentInput = {
      customerName,
      phone,
      scheduledAt: scheduled.toISOString(),
      memberId: draft.memberId === '' ? null : Number(draft.memberId),
      request: draft.legacyRequest,
      note: draft.note.trim(),
    };
    setFormError('');
    const onSuccess = () => {
      void cache.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
      setNotice(editing ? 'Đã cập nhật lịch hẹn.' : 'Đã thêm lịch hẹn.');
      setDraft(null);
      setEditing(null);
    };
    if (editing) {
      update.mutate({ id: editing.id, data }, { onSuccess, onError: (error) => setFormError(errorText(error)) });
    } else {
      create.mutate({ data }, { onSuccess, onError: (error) => setFormError(errorText(error)) });
    }
  }

  function askDelete(appointment: Appointment) {
    setNotice('');
    setConfirm({
      title: `Xóa lịch hẹn của ${appointment.customerName || 'khách chưa nhập tên'}?`,
      body: <p>Lịch hẹn này sẽ bị xóa khỏi sổ chung của cơ sở. Thao tác không thể hoàn tác.</p>,
      confirmLabel: 'Xóa lịch hẹn',
      onConfirm: () => remove.mutate({ id: appointment.id }, {
        onSuccess: () => {
          void cache.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
          setConfirm(null);
          setNotice(`Đã xóa lịch hẹn của ${appointment.customerName || 'khách'}.`);
        },
        onError: (error) => {
          setConfirm(null);
          setNotice('');
          setFormError(errorText(error));
        },
      }),
    });
  }

  return (
    <section className="appointments-page" aria-labelledby="appointments-title">
      <div className="appointments-heading">
        <div className="appointments-title-block">
          <span className="appointments-kicker"><CalendarDays size={14} aria-hidden="true" />SỔ CÔNG · CƠ SỞ</span>
          <h1 id="appointments-title" className="page-title">Lịch hẹn</h1>
          <p className="sub">Sổ lịch hẹn dùng chung cho toàn cơ sở.</p>
        </div>
        {canEdit && <button type="button" className="btn primary" onClick={openNew} data-testid="button-add-appointment">
          <Plus size={15} aria-hidden="true" />Thêm lịch hẹn
        </button>}
      </div>

      {notice && <div className="banner success" role="status" data-testid="status-appointment-notice">{notice}</div>}
      {formError && !draft && <ErrorBanner text={formError} />}
      <section className="panel appointment-panel staff-activity-panel" aria-labelledby="staff-activity-title">
        <div className="panel-head wrap">
          <div>
            <h2 id="staff-activity-title">Trạng thái nhân viên hôm nay</h2>
            <p className="sub">Tự cập nhật theo thời lượng ca đã ghi; trạng thái làm việc được làm mới mỗi 30 giây.</p>
          </div>
          <span className="staff-activity-count">{staffActivity.data?.length ?? 0} nhân viên</span>
        </div>
        {staffActivity.isLoading ? <Skeleton rows={3} label="Đang tải trạng thái nhân viên" /> : staffActivity.isError ? (
          <ErrorBanner text="Không tải được trạng thái nhân viên." onRetry={() => void staffActivity.refetch()} />
        ) : !staffActivity.data?.length ? (
          <div className="staff-activity-empty">Chưa có nhân viên đang hoạt động.</div>
        ) : (
          <ul className="staff-activity-list" data-testid="list-staff-activity">
            {staffActivity.data.map((activity) => {
              const details = activityDetails(activity);
              const canOpenAttendance = canEditEmployees &&
                members.some((member) => member.id === activity.memberId);
              const staffIcon = (
                <span className="staff-activity-icon" aria-hidden="true">
                  {activity.state === 'working'
                    ? <BriefcaseBusiness size={17} />
                    : activity.state === 'off' ? <Coffee size={17} /> : <CheckCircle2 size={18} />}
                </span>
              );
              return (
                <li className={`staff-activity-row is-${activity.state}`} key={activity.memberId} data-testid={`staff-activity-${activity.memberId}`}>
                  {canOpenAttendance ? (
                    <button
                      type="button"
                      className="staff-activity-person staff-activity-person-button"
                      onClick={() => openAttendance(activity.memberId)}
                      aria-haspopup="dialog"
                      aria-label={`Chấm công cho ${activity.employeeName}`}
                      data-testid={`button-attendance-staff-${activity.memberId}`}
                    >
                      {staffIcon}
                      <span className="staff-activity-person-name">{activity.employeeName}</span>
                    </button>
                  ) : (
                    <div className="staff-activity-person">
                      {staffIcon}
                      <strong className="staff-activity-person-name">{activity.employeeName}</strong>
                    </div>
                  )}
                  <div
                    className={`staff-activity-state is-${activity.state}`}
                    role="status"
                    aria-label={details.map((detail) => detail.text).join('. ')}
                  >
                    {details.map((detail, index) => (
                      <span
                        className={`staff-activity-detail is-${detail.kind}`}
                        key={`${detail.kind}-${index}`}
                      >
                        {index === 0 && activity.state === 'working' && <Clock3 size={14} aria-hidden="true" />}
                        {index === 0 && activity.state === 'available' && <CheckCircle2 size={14} aria-hidden="true" />}
                        {index === 0 && activity.state === 'off' && <Coffee size={14} aria-hidden="true" />}
                        {detail.text}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      className="btn small staff-activity-toggle"
                      disabled={updateActivity.isPending || activity.state === 'working'}
                      onClick={() => setEmployeeOff(activity)}
                      aria-label={activity.state === 'off' ? `Cho ${activity.employeeName} trở lại làm` : `Đánh dấu ${activity.employeeName} nghỉ`}
                      data-testid={`button-staff-activity-${activity.memberId}`}
                    >
                      {updateActivity.isPending && updateActivity.variables?.memberId === activity.memberId
                        ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
                        : null}
                      {activity.state === 'off' ? 'Trở lại làm' : activity.state === 'working' ? 'Đang làm' : 'Đánh dấu nghỉ'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="panel appointment-panel" aria-labelledby="appointment-list-title">
        <div className="panel-head wrap">
          <div>
            <h2 id="appointment-list-title">Danh sách lịch hẹn <span className="count">{records.length}</span></h2>
            <p className="sub">Sắp xếp theo ngày và giờ hẹn.</p>
          </div>
        </div>
        {appointments.isLoading ? <Skeleton rows={5} label="Đang tải lịch hẹn" /> : appointments.isError ? (
          <ErrorBanner text="Không tải được lịch hẹn." onRetry={() => void appointments.refetch()} />
        ) : records.length === 0 ? (
          <div className="empty appointment-empty">
            <CalendarDays size={24} aria-hidden="true" />
            <strong>Chưa có lịch hẹn</strong>
            <p>Thêm lịch hẹn đầu tiên để cả cơ sở cùng theo dõi.</p>
            {canEdit && <button type="button" className="btn small" onClick={openNew} data-testid="button-add-first-appointment">
              <Plus size={14} aria-hidden="true" />Thêm lịch hẹn
            </button>}
          </div>
        ) : (
          <div className="appointment-list" data-testid="list-appointments">
            {records.map((appointment) => {
              const appointmentDate = formatAppointmentDate(appointment.scheduledAt);
              return (
                <article className="appointment-row" key={appointment.id} data-testid={`row-appointment-${appointment.id}`}>
                  <div className="appointment-when">
                    <span className="appointment-date">{appointmentDate}</span>
                    <span className="appointment-time">{formatAppointmentTime(appointment.scheduledAt)}</span>
                    <span className={`appointment-status ${appointment.status === 'completed' ? 'is-completed' : 'is-scheduled'}`}
                      data-testid={`status-appointment-${appointment.id}`}>
                      {appointment.status === 'completed' ? 'Đã hoàn tất' : 'Chưa hoàn tất'}
                    </span>
                  </div>
                  <div className="appointment-customer">
                    <strong><UserRound size={15} aria-hidden="true" />{appointment.customerName || 'Khách chưa nhập tên'}</strong>
                    {appointment.phone && phoneCallHref(appointment.phone) ? (
                      <a href={phoneCallHref(appointment.phone)!} className="appointment-phone" data-testid={`link-appointment-phone-${appointment.id}`}>
                        <Phone size={13} aria-hidden="true" />{appointment.phone}
                      </a>
                    ) : appointment.phone ? (
                      <span className="appointment-phone" aria-label="Số điện thoại đã được che">{appointment.phone}</span>
                    ) : <span className="appointment-phone is-empty">Chưa nhập số điện thoại</span>}
                  </div>
                  <div className="appointment-detail-lines">
                    <p className="appointment-note">
                      {appointment.memberId === null
                        ? 'Chưa chọn nhân viên'
                        : `Nhân viên: ${staffActivity.data?.find((row) => row.memberId === appointment.memberId)?.employeeName ?? `#${appointment.memberId}`}`}
                    </p>
                    <p className={`appointment-note${appointment.note ? '' : ' is-empty'}`}>
                      {appointment.note ? <><strong>Ghi chú:</strong> {appointment.note}</> : 'Chưa có ghi chú'}
                    </p>
                  </div>
                  {canEdit && <div className="row-actions appointment-actions">
                    <button type="button" className="icon-btn" aria-label={`Sửa lịch hẹn ${appointment.customerName}`}
                      onClick={() => openEdit(appointment)} data-testid={`button-edit-appointment-${appointment.id}`}>
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-btn danger" aria-label={`Xóa lịch hẹn ${appointment.customerName}`}
                      disabled={remove.isPending} onClick={() => askDelete(appointment)} data-testid={`button-delete-appointment-${appointment.id}`}>
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {draft && (
        <Modal title={editing ? 'Sửa lịch hẹn' : 'Thêm lịch hẹn'} onClose={closeForm} testId="dialog-appointment">
          <form className="appointment-form" onSubmit={submit} noValidate data-testid="form-appointment" data-keyboard-shortcut-save="true">
            <label className="field" htmlFor="appointment-customer">Tên khách <span className="hint">Không bắt buộc</span>
              <input id="appointment-customer" value={draft.customerName} maxLength={160} autoComplete="name"
                onChange={(event) => { setFormError(''); setDraft({ ...draft, customerName: event.target.value }); }}
                data-testid="input-appointment-customer" />
            </label>
            <label className="field" htmlFor="appointment-phone">Số điện thoại <span className="hint">Không bắt buộc</span>
              <input id="appointment-phone" type="tel" inputMode="tel" value={draft.phone} maxLength={40} autoComplete="tel"
                onChange={(event) => { setFormError(''); setDraft({ ...draft, phone: event.target.value }); }}
                data-testid="input-appointment-phone" />
            </label>
            <label className="field" htmlFor="appointment-date">Ngày hẹn
              <input id="appointment-date" type="date" value={draft.date}
                onChange={(event) => { setFormError(''); setDraft({ ...draft, date: event.target.value }); }}
                required aria-required="true" data-testid="input-appointment-date" />
            </label>
            <div className="appointment-time-fields" role="group" aria-label="Thời gian hẹn">
              <label className="field" htmlFor="appointment-hour">Giờ
                <input id="appointment-hour" type="number" inputMode="numeric" min="0" max="23" step="1"
                  value={draft.hour} onChange={(event) => { setFormError(''); setDraft({ ...draft, hour: event.target.value }); }}
                  required aria-required="true" data-testid="input-appointment-hour" />
              </label>
              <label className="field" htmlFor="appointment-minute">Phút
                <input id="appointment-minute" type="number" inputMode="numeric" min="0" max="59" step="1"
                  value={draft.minute} onChange={(event) => { setFormError(''); setDraft({ ...draft, minute: event.target.value }); }}
                  required aria-required="true" data-testid="input-appointment-minute" />
              </label>
            </div>
            <label className="field" htmlFor="appointment-member">Nhân viên <span className="hint">Không bắt buộc</span>
              <select id="appointment-member" value={draft.memberId}
                onChange={(event) => { setFormError(''); setDraft({ ...draft, memberId: event.target.value }); }}
                data-testid="select-appointment-member">
                <option value="">Chưa chọn</option>
                {draft.memberId && !staffActivity.data?.some((row) => String(row.memberId) === draft.memberId) &&
                  <option value={draft.memberId}>Nhân viên cũ (#{draft.memberId})</option>}
                {staffActivity.data?.map((member) =>
                  <option value={member.memberId} key={member.memberId}>{member.employeeName}</option>)}
              </select>
            </label>
            <label className="field" htmlFor="appointment-note">Ghi chú <span className="hint">Không bắt buộc</span>
              <textarea id="appointment-note" value={draft.note} maxLength={2000} rows={3}
                onChange={(event) => { setFormError(''); setDraft({ ...draft, note: event.target.value }); }}
                data-testid="input-appointment-note" />
            </label>
            {formError && <p className="form-error" role="alert" data-testid="status-appointment-form-error">{formError}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn ghost" onClick={closeForm} disabled={busy} data-testid="button-appointment-cancel">Hủy</button>
              <button type="submit" className="btn primary" disabled={busy} data-testid="button-appointment-save">
                {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
                {editing ? 'Lưu thay đổi' : 'Lưu lịch hẹn'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {attendanceMemberId !== null && canEditEmployees && (
        <SessionDialog
          session={null}
          members={members}
          allowCards={canEditCards}
          cards={canEditCards ? cards.data ?? [] : []}
          cardsLoading={canEditCards && cards.isLoading}
          defaultDate={period.today}
          fixedMemberId={attendanceMemberId}
          busy={createSession.isPending}
          serverError={attendanceError}
          onClose={() => {
            if (createSession.isPending) return;
            setAttendanceMemberId(null);
            setAttendanceError('');
          }}
          onSubmit={submitAttendance}
        />
      )}
      {confirm && <ConfirmDialog state={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />}
    </section>
  );
}
