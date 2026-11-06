import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAppointmentStaffActivityQueryKey,
  getListAppointmentsQueryKey, useCreateAppointment, useDeleteAppointment,
  useListAppointmentStaffActivity, useListAppointments, useUpdateAppointment,
  useUpdateAppointmentStaffActivity,
} from '@workspace/api-client-react';
import type { Appointment, AppointmentInput, AppointmentStaffActivity } from '@workspace/api-client-react';
import { BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Coffee, LoaderCircle, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { ConfirmDialog, ErrorBanner, Modal, Skeleton, type ConfirmState } from '@/components/modal';
import { useShell } from '@/components/app-shell';
import { phoneCallHref } from '@/lib/phone';
import { errorText } from '@/lib/massage';

type AppointmentDraft = { customerName: string; phone: string; scheduledAt: string; request: string; note: string };

const blankDraft = (): AppointmentDraft => ({
  customerName: '', phone: '', scheduledAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)), request: '', note: '',
});

function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromAppointment(appointment: Appointment): AppointmentDraft {
  return {
    customerName: appointment.customerName,
    phone: appointment.phone,
    scheduledAt: toLocalInput(new Date(appointment.scheduledAt)),
    request: appointment.request ?? '',
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

function activityLabel(activity: AppointmentStaffActivity) {
  if (activity.state === 'working') {
    return `Đang làm${activity.serviceType ? ` · ${activity.serviceType}` : ''}${activity.endsAt ? ` · xong lúc ${formatActivityEnd(activity.endsAt)}` : ''}`;
  }
  return activity.state === 'off' ? 'Đang nghỉ' : 'Rảnh';
}

export default function AppointmentsPage() {
  const { permissions } = useShell();
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
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const records = useMemo(
    () => [...(appointments.data ?? [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [appointments.data],
  );
  const busy = create.isPending || update.isPending;

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
    if (!customerName) return setFormError('Nhập tên khách.');
    if (customerName.length > 160) return setFormError('Tên khách không được dài quá 160 ký tự.');
    if (!phone) return setFormError('Nhập số điện thoại.');
    if (phone.length > 40) return setFormError('Số điện thoại không được dài quá 40 ký tự.');
    if (draft.request.trim().length > 2000) return setFormError('Yêu cầu không được dài quá 2.000 ký tự.');
    const scheduled = new Date(draft.scheduledAt);
    if (!draft.scheduledAt || Number.isNaN(scheduled.getTime())) return setFormError('Chọn ngày và giờ hẹn hợp lệ.');
    if (draft.note.trim().length > 2000) return setFormError('Ghi chú không được dài quá 2.000 ký tự.');
    const data: AppointmentInput = {
      customerName,
      phone,
      scheduledAt: scheduled.toISOString(),
      request: draft.request.trim(),
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
      title: `Xóa lịch hẹn của ${appointment.customerName}?`,
      body: <p>Lịch hẹn này sẽ bị xóa khỏi sổ chung của cơ sở. Thao tác không thể hoàn tác.</p>,
      confirmLabel: 'Xóa lịch hẹn',
      onConfirm: () => remove.mutate({ id: appointment.id }, {
        onSuccess: () => {
          void cache.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
          setConfirm(null);
          setNotice(`Đã xóa lịch hẹn của ${appointment.customerName}.`);
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
            {staffActivity.data.map((activity) => (
              <li className={`staff-activity-row is-${activity.state}`} key={activity.memberId} data-testid={`staff-activity-${activity.memberId}`}>
                <div className="staff-activity-person">
                  <span className="staff-activity-icon" aria-hidden="true">
                    {activity.state === 'working'
                      ? <BriefcaseBusiness size={17} />
                      : activity.state === 'off' ? <Coffee size={17} /> : <CheckCircle2 size={18} />}
                  </span>
                  <strong>{activity.employeeName}</strong>
                </div>
                <span className={`staff-activity-state is-${activity.state}`} role="status">
                  {activity.state === 'working' && <Clock3 size={14} aria-hidden="true" />}
                  {activity.state === 'available' && <CheckCircle2 size={14} aria-hidden="true" />}
                  {activity.state === 'off' && <Coffee size={14} aria-hidden="true" />}
                  {activityLabel(activity)}
                </span>
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
            ))}
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
                    <span className={`appointment-status ${appointment.status === 'completed' ? 'is-completed' : 'is-scheduled'}`}
                      data-testid={`status-appointment-${appointment.id}`}>
                      {appointment.status === 'completed' ? 'Đã hoàn tất' : 'Chưa hoàn tất'}
                    </span>
                  </div>
                  <div className="appointment-customer">
                    <strong><UserRound size={15} aria-hidden="true" />{appointment.customerName}</strong>
                    {phoneCallHref(appointment.phone) ? (
                      <a href={phoneCallHref(appointment.phone)!} className="appointment-phone" data-testid={`link-appointment-phone-${appointment.id}`}>
                        <Phone size={13} aria-hidden="true" />{appointment.phone}
                      </a>
                    ) : (
                      <span className="appointment-phone" aria-label="Số điện thoại đã được che">{appointment.phone}</span>
                    )}
                  </div>
                  <div className="appointment-detail-lines">
                    <p className={`appointment-note${appointment.request ? '' : ' is-empty'}`}>
                      {appointment.request ? <><strong>Yêu cầu:</strong> {appointment.request}</> : 'Chưa có yêu cầu'}
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
          <form className="appointment-form" onSubmit={submit} noValidate data-testid="form-appointment">
            <label className="field" htmlFor="appointment-customer">Tên khách
              <input id="appointment-customer" value={draft.customerName} maxLength={160} autoComplete="name"
                onChange={(event) => { setFormError(''); setDraft({ ...draft, customerName: event.target.value }); }}
                required aria-required="true" data-testid="input-appointment-customer" />
            </label>
            <label className="field" htmlFor="appointment-phone">Số điện thoại
              <input id="appointment-phone" type="tel" inputMode="tel" value={draft.phone} maxLength={40} autoComplete="tel"
                onChange={(event) => { setFormError(''); setDraft({ ...draft, phone: event.target.value }); }}
                required aria-required="true" data-testid="input-appointment-phone" />
            </label>
            <label className="field" htmlFor="appointment-date">Ngày hẹn
              <input id="appointment-date" type="date" value={draft.scheduledAt.slice(0, 10)}
                onChange={(event) => { setFormError(''); setDraft({ ...draft, scheduledAt: event.target.value ? `${event.target.value}T${draft.scheduledAt.slice(11, 16) || '12:00'}` : draft.scheduledAt }); }}
                required aria-required="true" data-testid="input-appointment-date" />
            </label>
            <label className="field" htmlFor="appointment-request">Yêu cầu <span className="hint">Giờ hẹn, nhân viên khách muốn gặp · Không bắt buộc</span>
              <textarea id="appointment-request" value={draft.request} maxLength={2000} rows={3}
                placeholder="Ví dụ: 15:30, muốn gặp nhân viên Lan"
                onChange={(event) => { setFormError(''); setDraft({ ...draft, request: event.target.value }); }}
                data-testid="input-appointment-request" />
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
      {confirm && <ConfirmDialog state={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />}
    </section>
  );
}
