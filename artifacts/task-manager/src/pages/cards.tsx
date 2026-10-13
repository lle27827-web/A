import { useMemo, useState } from 'react';
import { getListTreatmentCardsQueryKey, useCreateTreatmentCard, useListTreatmentCards } from '@workspace/api-client-react';
import { ArrowLeft, ChevronRight, CreditCard, LockKeyhole, Plus, Search, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useShell } from '@/components/app-shell';
import { CardDialog } from '@/components/entity-dialogs';
import { ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate, localDate, normalize } from '@/lib/attendance';
import { errorText, formatMinutes, formatVnd, useRefreshMassage } from '@/lib/massage';

export default function CardsPage() {
  const { canEdit, isOwner, query, setQuery, notify, fail } = useShell();
  const [, navigate] = useLocation();
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), refetchOnWindowFocus: true } });
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const create = useCreateTreatmentCard();
  const refresh = useRefreshMassage();
  const cards = useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);
  const list = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return cards;
    const digits = /^[\d\s.\-+]+$/.test(query.trim()) ? query.replace(/[^\d]/g, '') : '';
    return cards.filter((c) => normalize(c.customerName).includes(q) || (digits !== '' && c.phone.replace(/[^\d]/g, '').includes(digits)));
  }, [cards, query]);

  return (
    <section className="panel page" aria-labelledby="cards-title">
      <Link href="/" className="back" data-testid="link-back"><ArrowLeft size={15} />Trang chính</Link>
      <div className="panel-head wrap">
        <div><h1 id="cards-title" className="page-title">Quản lý thẻ</h1><p className="sub">Thẻ liệu trình của khách · trừ theo giờ phục vụ</p></div>
        {canEdit ? <button type="button" className="btn primary" onClick={() => { setDialogError(''); setOpen(true); }} data-testid="button-add-card"><Plus size={15} />Bán thẻ mới</button>
          : <span className="view-only"><LockKeyhole size={13} />Chỉ xem</span>}
      </div>
      <form role="search" className="card-search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="card-search">Tìm thẻ theo tên khách hoặc số điện thoại</label>
        <div className="card-search-box">
          <Search size={15} aria-hidden="true" />
          <input id="card-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" placeholder="Ví dụ: Lan hoặc 0903 123" aria-describedby="card-search-hint" data-testid="input-card-search" />
          {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm thẻ" data-testid="button-clear-card-search"><X size={14} /></button>}
        </div>
        <span id="card-search-hint" className="hint" role="status" data-testid="text-card-count">
          {query.trim() ? `${list.length} / ${cards.length} thẻ khớp` : `${cards.length} thẻ`}{isOwner ? '' : ' · Chế độ xem chỉ tìm theo phần số điện thoại đang hiển thị.'}
        </span>
      </form>
      {cardsQuery.isLoading ? <Skeleton rows={5} label="Đang tải thẻ" /> : cardsQuery.isError ? <ErrorBanner text={errorText(cardsQuery.error, 'Không tải được danh sách thẻ.')} onRetry={() => void cardsQuery.refetch()} /> : list.length === 0 ? (
        <div className="empty"><CreditCard size={22} /><p>{cards.length ? 'Không có thẻ khớp tìm kiếm.' : 'Chưa có thẻ khách hàng nào.'}</p>
          {canEdit && !cards.length && <button type="button" className="btn primary" onClick={() => setOpen(true)}><Plus size={15} />Bán thẻ đầu tiên</button>}</div>
      ) : (
        <ul className="card-list">
          {list.map((c) => {
            const pct = c.totalMinutes ? Math.max(0, Math.min(100, (c.remainingMinutes / c.totalMinutes) * 100)) : 0;
            return (
              <li key={c.id}>
                <Link href={`/cards/${c.id}`} className="card-row" data-testid={`link-card-${c.id}`}>
                  <span className="grow">
                    <strong>{c.customerName}</strong>
                    <span className="muted">{c.phone} · {c.serviceType} · mua {formatShortDate(c.purchaseDate)} · {formatVnd(c.purchaseAmount)}</span>
                    <span className="meter" aria-hidden="true"><span style={{ transform: `scaleX(${pct / 100})` }} /></span>
                  </span>
                  <span className="remain mono"><strong>{formatMinutes(c.remainingMinutes)}</strong><span className="muted">/ {formatMinutes(c.totalMinutes)}</span></span>
                  <ChevronRight size={18} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {open && canEdit && (
        <CardDialog card={null} defaultDate={localDate()} busy={create.isPending} serverError={dialogError} onClose={() => setOpen(false)}
          onSubmit={(data) => create.mutate({ data }, {
            onSuccess: (card) => { refresh(); setOpen(false); notify(`Đã bán thẻ cho ${card.customerName}.`); navigate(`/cards/${card.id}`); },
            onError: (e) => { setDialogError(errorText(e)); fail(e); },
          })} />
      )}
    </section>
  );
}
