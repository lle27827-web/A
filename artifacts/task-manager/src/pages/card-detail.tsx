import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey,
  useCreateServiceSession, useDeleteServiceSession, useDeleteTreatmentCard, useListServiceSessions, useListTreatmentCards,
  useUpdateServiceSession, useUpdateTreatmentCard, useAddTreatmentCardHours,
} from '@workspace/api-client-react';
import type { ServiceSession, ServiceSessionInput, TreatmentCard } from '@workspace/api-client-react';
import { ArrowLeft, CreditCard, Pencil, Plus, Trash2 } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import { useShell } from '@/components/app-shell';
import { CardDialog } from '@/components/entity-dialogs';
import { CardHoursDialog } from '@/components/card-hours-dialog';
import { ConfirmDialog, ErrorBanner, Skeleton, type ConfirmState } from '@/components/modal';
import { SessionDialog } from '@/components/session-dialog';
import { SessionTable } from '@/components/session-table';
import { formatShortDate, localDate } from '@/lib/attendance';
import { SESSION_FRESHNESS, errorText, formatMinutes, formatVnd, useRefreshMassage } from '@/lib/massage';

export default function CardDetailPage() {
  const params = useParams<{ id: string }>();
  const n = Number(params.id);
  const id = Number.isInteger(n) && n > 0 ? n : 0;
  const { canEdit, members, notify, fail, setQuery } = useShell();
  const [, navigate] = useLocation();
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), ...SESSION_FRESHNESS } });
  const sessionParams = useMemo(() => ({ cardId: id }), [id]);
  const sessionsQuery = useListServiceSessions(sessionParams, { query: { queryKey: getListServiceSessionsQueryKey(sessionParams), enabled: id > 0, ...SESSION_FRESHNESS } });
  const updateCard = useUpdateTreatmentCard();
  const addHours = useAddTreatmentCardHours();
  const deleteCard = useDeleteTreatmentCard();
  const createSession = useCreateServiceSession();
  const updateSession = useUpdateServiceSession();
  const deleteSession = useDeleteServiceSession();
  const refresh = useRefreshMassage();
  const cache = useQueryClient();
  const [cardDialog, setCardDialog] = useState(false);
  const [hoursDialog, setHoursDialog] = useState(false);
  const [sessionDialog, setSessionDialog] = useState<{ session: ServiceSession | null } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [dialogError, setDialogError] = useState('');

  const card = (cardsQuery.data ?? []).find((c) => c.id === id) ?? null;
  const sessions = useMemo(() => [...(sessionsQuery.data ?? [])].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.id - a.id), [sessionsQuery.data]);
  const back = <Link href="/" onClick={() => setQuery('')} className="back" data-testid="link-back"><ArrowLeft size={15} />Trang chính</Link>;

  if (cardsQuery.isLoading || (!card && cardsQuery.isFetching)) return <section className="panel page">{back}<Skeleton rows={6} label="Đang tải thẻ" /></section>;
  if (cardsQuery.isError) return <section className="panel page">{back}<ErrorBanner text="Không tải được thẻ." onRetry={() => void cardsQuery.refetch()} /></section>;
  if (!card) return <section className="panel page">{back}<div className="empty"><CreditCard size={22} /><p>Thẻ không tồn tại hoặc đã bị xóa.</p><Link href="/cards" className="btn">Về danh sách thẻ</Link></div></section>;

  function submitSession(input: ServiceSessionInput) {
    if (!canEdit || !sessionDialog || !card) return;
    setDialogError('');
    const data = { ...input, cardId: card.id };
    const opts = { onSuccess: () => { refresh(); setSessionDialog(null); notify(sessionDialog.session ? 'Đã cập nhật lần dùng thẻ.' : 'Đã ghi lần dùng thẻ.'); }, onError: (e: unknown) => { setDialogError(errorText(e)); fail(e); } };
    if (sessionDialog.session) updateSession.mutate({ id: sessionDialog.session.id, data }, opts);
    else createSession.mutate({ data }, opts);
  }
  function askDeleteSession(s: ServiceSession) {
    setConfirm({
      title: 'Xóa lần dùng thẻ?',
      body: <p>Xóa lần dùng ngày {formatShortDate(s.workDate)} ({formatMinutes(s.minutes)}, {s.employeeName}). {formatMinutes(s.minutes)} được hoàn lại vào thẻ và lương {formatVnd(s.earnings)} bị trừ khỏi bảng lương của kỹ thuật viên. Không thể hoàn tác.</p>,
      confirmLabel: 'Xóa lần dùng',
      onConfirm: () => deleteSession.mutate({ id: s.id }, { onSuccess: () => { refresh(); setConfirm(null); notify('Đã xóa lần dùng thẻ.'); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }
  function askDeleteCard() {
    if (!card) return;
    setConfirm({
      title: `Xóa thẻ của ${card.customerName}?`,
      body: <p>Thẻ sẽ bị ẩn khỏi danh sách. Tổng tiền mua và nạp {formatVnd(card.totalPaidAmount)}, {sessions.length} ca sử dụng liên quan, tiền công và lượt khách sẽ không còn tính trong báo cáo. Dữ liệu lịch sử vẫn được lưu trữ.</p>,
      confirmLabel: 'Xóa thẻ',
      onConfirm: () => deleteCard.mutate({ id: card.id }, { onSuccess: () => { refresh(); setConfirm(null); notify('Đã xóa thẻ.'); navigate('/cards'); }, onError: (e) => { setConfirm(null); fail(e); } }),
    });
  }

  const pct = card.totalMinutes ? Math.max(0, Math.min(1, card.remainingMinutes / card.totalMinutes)) : 0;
  return (
    <div className="detail">
      {back}
      <section className="salary-hero" aria-labelledby="card-title" data-testid="section-card">
        <div className="hero-top">
          <span className="initials big"><CreditCard size={20} /></span>
          <div className="grow"><h1 id="card-title" className="page-title" data-testid="text-card-customer">{card.customerName}</h1>
            <p className="sub" data-testid="text-card-phone">{card.phone} · {card.serviceType}</p></div>
          {canEdit && (
            <div className="head-actions">
              <button type="button" className="btn" onClick={() => { setDialogError(''); setCardDialog(true); }} data-testid="button-edit-card"><Pencil size={14} />Sửa thẻ</button>
              <button type="button" className="icon-btn danger" onClick={askDeleteCard} aria-label="Xóa thẻ" data-testid="button-delete-card"><Trash2 size={15} /></button>
            </div>
          )}
        </div>
        <p className="rev-label">Giờ còn lại</p>
        <p className="rev-value mono" data-testid="text-card-remaining">{formatMinutes(card.remainingMinutes)}</p>
        <span className="meter big" aria-hidden="true"><span style={{ transform: `scaleX(${pct})` }} /></span>
        <dl className="facts">
          <div><dt>Đã mua</dt><dd className="mono">{formatMinutes(card.totalMinutes)}</dd></div>
          <div><dt>Đã dùng</dt><dd className="mono">{formatMinutes(card.usedMinutes)}</dd></div>
          <div><dt>Tổng tiền đã trả</dt><dd className="mono" data-testid="text-card-total-paid">{formatVnd(card.totalPaidAmount)}</dd></div>
          <div><dt>Ngày mua</dt><dd className="mono">{formatShortDate(card.purchaseDate)}</dd></div>
        </dl>
        {card.note && <p className="sub">Ghi chú: {card.note}</p>}
      </section>

      {canEdit && <button type="button" className="btn primary" onClick={() => { setDialogError(''); setHoursDialog(true); }} data-testid="button-add-card-hours"><Plus size={15} />Nạp thẻ</button>}

      <section className="panel" aria-labelledby="payments-title" data-testid="section-card-payments">
        <div className="panel-head"><h2 id="payments-title">Lịch sử mua và nạp thẻ</h2></div>
        <ul className="emp-list">
          {card.topUps.map((payment) => (
            <li className="emp-row wrap" key={payment.id} data-testid={`row-card-topup-${payment.id}`}>
              <span className="grow">
                <strong>{payment.source === 'merged_sale' ? 'Nạp từ thẻ mới trùng thông tin' : 'Nạp thẻ'}</strong>
                <span className="muted">{formatShortDate(payment.paymentDate)} · {formatMinutes(payment.minutes)}</span>
                <span className="muted">Ghi lúc {new Date(payment.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                {payment.note && <span className="muted">{payment.note}</span>}
              </span>
              <strong className="mono">{formatVnd(payment.amount)}</strong>
            </li>
          ))}
          <li className="emp-row wrap" data-testid="row-card-initial-purchase">
            <span className="grow"><strong>Mua thẻ ban đầu</strong>
              <span className="muted">{formatShortDate(card.purchaseDate)} · {formatMinutes(card.totalMinutes - card.topUps.reduce((sum, payment) => sum + payment.minutes, 0))}</span>
            </span>
            <strong className="mono">{formatVnd(card.purchaseAmount)}</strong>
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="usage-title">
        <div className="panel-head wrap">
          <div><h2 id="usage-title">Lịch sử sử dụng</h2><p className="sub">{sessions.length} lần</p></div>
          {canEdit && <button type="button" className="btn primary" disabled={card.remainingMinutes <= 0} onClick={() => { setDialogError(''); setSessionDialog({ session: null }); }} data-testid="button-add-usage"><Plus size={15} />Ghi lần dùng</button>}
        </div>
        {sessionsQuery.isLoading ? <Skeleton rows={3} label="Đang tải lịch sử" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được lịch sử sử dụng." onRetry={() => void sessionsQuery.refetch()} /> : sessions.length === 0 ? (
          <div className="empty small"><CreditCard size={18} /><p>Thẻ chưa được sử dụng.</p></div>
        ) : (
          <SessionTable sessions={sessions} caption="Lịch sử dùng thẻ. Ngày là ngày phục vụ; giờ ghi là lúc lưu ca." canEdit={canEdit} cardHistory showDate showTime showEmployee busy={deleteSession.isPending}
            onEdit={(s) => { setDialogError(''); setSessionDialog({ session: s }); }} onDelete={askDeleteSession} testId="card-usages" />
        )}
      </section>

      {cardDialog && canEdit && (
        <CardDialog card={card} defaultDate={localDate()} busy={updateCard.isPending} serverError={dialogError} onClose={() => setCardDialog(false)}
          onSubmit={(data) => updateCard.mutate({ id: card.id, data }, { onSuccess: () => { refresh(); setCardDialog(false); notify('Đã cập nhật thẻ.'); }, onError: (e) => { setDialogError(errorText(e)); fail(e); } })} />
      )}
      {hoursDialog && canEdit && (
        <CardHoursDialog card={card} busy={addHours.isPending} serverError={dialogError} onClose={() => setHoursDialog(false)}
          onSubmit={(data) => {
            if (!canEdit || addHours.isPending) return;
            setDialogError('');
            addHours.mutate({ id: card.id, data }, {
              onSuccess: (saved) => {
                cache.setQueryData<TreatmentCard[]>(getListTreatmentCardsQueryKey(), (old) =>
                  old?.map((item) => item.id === saved.id ? saved : item));
                refresh(); setHoursDialog(false); notify(`Đã nạp ${formatMinutes(data.minutes)} · ${formatVnd(data.amount)} vào thẻ.`);
              },
              onError: (e) => { setDialogError(errorText(e)); fail(e); },
            });
          }} />
      )}
      {sessionDialog && canEdit && (
        <SessionDialog session={sessionDialog.session} members={members} cards={[card]} defaultDate={localDate()} fixedCardId={card.id}
          busy={createSession.isPending || updateSession.isPending} serverError={dialogError} onClose={() => setSessionDialog(null)} onSubmit={submitSession} />
      )}
      {confirm && <ConfirmDialog state={confirm} busy={deleteCard.isPending || deleteSession.isPending} onClose={() => setConfirm(null)} />}
    </div>
  );
}
