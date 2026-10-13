import { useMemo } from 'react';
import { getGetMassageSummaryQueryKey, getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey, useGetMassageSummary, useListServiceSessions, useListTreatmentCards } from '@workspace/api-client-react';
import { ArrowRight, CreditCard, Search, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate, initial, localDate, normalize } from '@/lib/attendance';
import { SESSION_FRESHNESS, formatMinutes, formatMonth, formatVnd, monthOf } from '@/lib/massage';

export default function HomePage() {
  const { query, members, membersLoading, setQuery } = useShell();
  const month = monthOf(localDate());
  const searching = query.trim().length > 0;
  const summaryParams = useMemo(() => ({ month }), [month]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });
  const cardsQuery = useListTreatmentCards({ query: { queryKey: getListTreatmentCardsQueryKey(), enabled: searching } });
  const sessionParams = useMemo(() => ({ month }), [month]);
  const sessionsQuery = useListServiceSessions(sessionParams, { query: { queryKey: getListServiceSessionsQueryKey(sessionParams), enabled: searching, ...SESSION_FRESHNESS } });

  const q = normalize(query);
  const memberHits = useMemo(() => (searching ? members.filter((m) => normalize(m.name).includes(q)) : []), [members, q, searching]);
  const cardHits = useMemo(() => (searching ? (cardsQuery.data ?? []).filter((c) => normalize([c.customerName, c.phone, c.serviceType, c.note].join(' ')).includes(q)) : []), [cardsQuery.data, q, searching]);
  const sessionHits = useMemo(() => (searching ? (sessionsQuery.data ?? []).filter((s) => normalize([s.employeeName, s.customerName, s.serviceType, s.note, formatShortDate(s.workDate)].join(' ')).includes(q)) : []), [sessionsQuery.data, q, searching]);

  if (searching) {
    return (
      <section className="panel" aria-labelledby="search-title" data-testid="section-search-results">
        <div className="panel-head"><div><h2 id="search-title">Kết quả cho “{query.trim()}”</h2><p className="sub" aria-live="polite">{memberHits.length} nhân viên · {cardHits.length} thẻ · {sessionHits.length} ca trong {formatMonth(month).toLowerCase()}</p></div></div>
        <h3 className="group-title">Nhân viên</h3>
        {membersLoading ? <Skeleton rows={2} label="Đang tải nhân viên" /> : memberHits.length === 0 ? <p className="muted small">Không có nhân viên khớp.</p> : (
          <ul className="hit-list">{memberHits.map((m) => <li key={m.id}><Link href={`/employees/${m.id}`} className="hit" data-testid={`link-search-member-${m.id}`}><span className="initials">{initial(m.name)}</span><span className="grow">{m.name}</span><ArrowRight size={14} /></Link></li>)}</ul>
        )}
        <h3 className="group-title">Thẻ khách hàng</h3>
        {cardsQuery.isLoading ? <Skeleton rows={2} label="Đang tải thẻ" /> : cardsQuery.isError ? <ErrorBanner text="Không tải được thẻ." onRetry={() => void cardsQuery.refetch()} /> : cardHits.length === 0 ? <p className="muted small">Không có thẻ khớp.</p> : (
          <ul className="hit-list">{cardHits.map((c) => <li key={c.id}><Link href={`/cards/${c.id}`} className="hit" data-testid={`link-search-card-${c.id}`}><CreditCard size={16} /><span className="grow"><strong>{c.customerName}</strong> <span className="muted">· {c.phone} · {c.serviceType}</span></span><span className="mono">còn {formatMinutes(c.remainingMinutes)}</span></Link></li>)}</ul>
        )}
        <h3 className="group-title">Ca phục vụ tháng này</h3>
        {sessionsQuery.isLoading ? <Skeleton rows={2} label="Đang tải ca" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được ca phục vụ." onRetry={() => void sessionsQuery.refetch()} /> : sessionHits.length === 0 ? <p className="muted small">Không có ca khớp.</p> : (
          <ul className="hit-list">{sessionHits.slice(0, 40).map((s) => (
            <li key={s.id}>
              {s.memberId !== null ? (
                <Link href={`/employees/${s.memberId}?date=${s.workDate}`} className="hit" data-testid={`link-search-session-${s.id}`}><span className="mono">{formatShortDate(s.workDate)}</span><span className="grow">{s.employeeName} · {s.customerName || 'Khách lẻ'} · {s.serviceType}</span><span className="mono">{formatMinutes(s.minutes)}</span></Link>
              ) : <div className="hit"><span className="mono">{formatShortDate(s.workDate)}</span><span className="grow">{s.employeeName} (đã xóa) · {s.customerName || 'Khách lẻ'} · {s.serviceType}</span><span className="mono">{formatMinutes(s.minutes)}</span></div>}
            </li>
          ))}</ul>
        )}
        <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => setQuery('')}><Search size={14} />Xóa tìm kiếm</button>
      </section>
    );
  }

  return (
    <div className="home">
      <div className="tiles">
        <Link href="/employees" className="tile" data-testid="link-employees">
          <Users size={28} aria-hidden="true" />
          <span className="tile-kicker">Kỹ thuật viên · lương theo giờ phục vụ</span>
          <strong>Quản lý nhân viên</strong>
          <span className="tile-go">Mở <ArrowRight size={16} /></span>
        </Link>
        <Link href="/cards" className="tile alt" data-testid="link-cards">
          <CreditCard size={28} aria-hidden="true" />
          <span className="tile-kicker">Thẻ liệu trình · giờ còn lại</span>
          <strong>Quản lý thẻ</strong>
          <span className="tile-go">Mở <ArrowRight size={16} /></span>
        </Link>
      </div>
      <section className="revenue" aria-labelledby="rev-title" data-testid="section-revenue">
        <p id="rev-title" className="rev-label">Tổng doanh thu cơ sở · {formatMonth(month)}</p>
        {summary.isLoading ? <span className="rev-skel" role="status" aria-label="Đang tải doanh thu" /> : summary.isError ? <ErrorBanner text="Không tải được doanh thu." onRetry={() => void summary.refetch()} /> : (
          <>
            <p className="rev-value mono" data-testid="text-revenue">{formatVnd(summary.data?.revenue ?? 0)}</p>
            <dl className="rev-breakdown">
              <div><dt>Doanh thu dịch vụ</dt><dd className="mono" data-testid="text-service-revenue">{formatVnd(summary.data?.serviceRevenue ?? 0)}</dd></div>
              <p className="hint">Tổng lương đã ghi của mọi ca phục vụ trong tháng (theo ngày làm).</p>
              <div><dt>Tổng doanh thu bán thẻ</dt><dd className="mono" data-testid="text-card-revenue">{formatVnd(summary.data?.cardRevenue ?? 0)}</dd></div>
              <p className="hint" data-testid="text-cards-sold">{summary.data?.cardsSold ?? 0} thẻ bán ra · theo tiền bán thẻ và ngày mua</p>
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
