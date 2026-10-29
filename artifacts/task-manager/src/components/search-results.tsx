import { useMemo } from 'react';
import { getListServiceSessionsQueryKey, getListTreatmentCardsQueryKey, useListServiceSessions, useListTreatmentCards } from '@workspace/api-client-react';
import { ArrowRight, CreditCard, Search, X } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner, Skeleton } from '@/components/modal';
import { formatShortDate, initial, normalize } from '@/lib/attendance';
import { SESSION_FRESHNESS, formatMinutes, formatMonth } from '@/lib/massage';

/** Shared global search results, rendered first in AppShell main whenever the shared query is non-empty. */
export function SearchResults() {
  const shell = useShell();
  const { query, setQuery, members, membersLoading, membersError, retryMembers, permissions, canViewEmployees, employeeMode, historyMonth } = shell;
  const raw = query.trim();
  const searching = raw.length > 0;
  const canSearchCards = permissions.viewCards && !historyMonth;
  const month = shell.period.month;
  const { withHistory } = shell;
  const cardSearch = useMemo(() => ({ search: raw }), [raw]);
  const cardsQuery = useListTreatmentCards(cardSearch, {
    query: { queryKey: getListTreatmentCardsQueryKey(cardSearch), enabled: searching && canSearchCards, refetchOnWindowFocus: true },
  });
  const sessionParams = useMemo(() => ({ month }), [month]);
  const sessionsQuery = useListServiceSessions(sessionParams, { query: { queryKey: getListServiceSessionsQueryKey(sessionParams), enabled: searching && canViewEmployees, ...SESSION_FRESHNESS } });

  const q = normalize(raw);
  const memberHits = useMemo(() => (searching ? members.filter((m) => normalize(m.name).includes(q)) : []), [members, q, searching]);
  const cardHits = useMemo(() => (searching && canSearchCards ? cardsQuery.data ?? [] : []), [cardsQuery.data, canSearchCards, searching]);
  const sessionHits = useMemo(() => (searching ? (sessionsQuery.data ?? []).filter((s) => normalize([s.employeeName, s.customerName, s.serviceType, formatShortDate(s.workDate)].join(' ')).includes(q)) : []), [sessionsQuery.data, q, searching]);

  if (!searching) return null;

  // Leaving the results always clears the query; in employee preview, switch presentation to owner (never grants edit rights).
  function leave() {
    if (employeeMode) shell.setView({ mode: 'owner', employeeId: shell.prefs.employeeId });
    else setQuery('');
  }

  const allGroups = [
    { key: 'cards', hits: cardHits.length, loading: cardsQuery.isLoading, error: cardsQuery.isError, node: (
      <div key="cards">
        <h3 className="group-title">Thẻ khách hàng</h3>
        {cardsQuery.isLoading ? <Skeleton rows={2} label="Đang tải thẻ" /> : cardsQuery.isError ? <ErrorBanner text="Không tải được thẻ." onRetry={() => void cardsQuery.refetch()} /> : cardHits.length === 0 ? <p className="muted small">Không có thẻ khớp.</p> : (
          <ul className="hit-list">{cardHits.map((c) => <li key={c.id}><Link href={`/cards/${c.id}`} onClick={leave} className="hit" data-testid={`link-search-card-${c.id}`}><CreditCard size={16} /><span className="grow"><strong>{c.customerName}</strong> <span className="muted">· {c.phone} · {c.serviceType}</span></span><span className="mono">còn {formatMinutes(c.remainingMinutes)}</span></Link></li>)}</ul>
        )}
      </div>
    ) },
    { key: 'members', hits: memberHits.length, loading: membersLoading, error: membersError, node: (
      <div key="members">
        <h3 className="group-title">Nhân viên</h3>
        {membersLoading ? <Skeleton rows={2} label="Đang tải nhân viên" /> : membersError ? <ErrorBanner text="Không tải được nhân viên." onRetry={retryMembers} /> : memberHits.length === 0 ? <p className="muted small">Không có nhân viên khớp.</p> : (
          <ul className="hit-list">{memberHits.map((m) => <li key={m.id}><Link href={withHistory(`/employees/${m.id}`)} onClick={leave} className="hit" data-testid={`link-search-member-${m.id}`}><span className="initials">{initial(m.name)}</span><span className="grow">{m.name}</span><ArrowRight size={14} /></Link></li>)}</ul>
        )}
      </div>
    ) },
    { key: 'sessions', hits: sessionHits.length, loading: sessionsQuery.isLoading, error: sessionsQuery.isError, node: (
      <div key="sessions">
        <h3 className="group-title">Ca phục vụ {formatMonth(month).toLowerCase()}</h3>
        {sessionsQuery.isLoading ? <Skeleton rows={2} label="Đang tải ca" /> : sessionsQuery.isError ? <ErrorBanner text="Không tải được ca phục vụ." onRetry={() => void sessionsQuery.refetch()} /> : sessionHits.length === 0 ? <p className="muted small">Không có ca khớp.</p> : (
          <ul className="hit-list">{sessionHits.slice(0, 40).map((s) => (
            <li key={s.id}>
              {s.memberId !== null ? (
                <Link href={withHistory(`/employees/${s.memberId}?date=${s.workDate}`)} onClick={leave} className="hit" data-testid={`link-search-session-${s.id}`}><span className="mono">{formatShortDate(s.workDate)}</span><span className="grow">{s.employeeName} · {s.customerName || 'Khách lẻ'} · {s.serviceType}</span><span className="mono">{formatMinutes(s.minutes)}</span></Link>
              ) : <div className="hit"><span className="mono">{formatShortDate(s.workDate)}</span><span className="grow">{s.employeeName} (đã xóa) · {s.customerName || 'Khách lẻ'} · {s.serviceType}</span><span className="mono">{formatMinutes(s.minutes)}</span></div>}
            </li>
          ))}</ul>
        )}
      </div>
    ) },
  ];
  const groups = allGroups.filter((group) => group.key === 'cards' ? canSearchCards : canViewEmployees);
  // Groups with hits first (customer cards prioritised), then loading/error, then empty ones.
  const ordered = [...groups].sort((a, b) => Number(b.hits > 0) - Number(a.hits > 0) || Number(b.loading) - Number(a.loading));
  const anyLoading = groups.some((g) => g.loading);
  const anyError = groups.some((g) => g.error);
  const total = groups.reduce((a, g) => a + g.hits, 0);

  return (
    <section className="panel search-results" aria-labelledby="search-title" data-testid="section-search-results">
      <div className="panel-head wrap">
        <div><h2 id="search-title">Kết quả cho “{raw}”</h2>
          <p className="sub" aria-live="polite">{anyLoading ? 'Đang tìm…' : [canSearchCards && `${cardHits.length} thẻ`, canViewEmployees && `${memberHits.length} nhân viên · ${sessionHits.length} ca`].filter(Boolean).join(' · ')}</p></div>
        <button type="button" className="btn small ghost" onClick={() => setQuery('')} data-testid="button-clear-results"><X size={14} />Xóa tìm kiếm</button>
      </div>
      {!anyLoading && !anyError && total === 0 ? (
        <div className="empty"><Search size={20} /><p>Không có kết quả khớp.</p></div>
      ) : ordered.filter((g) => g.hits > 0 || g.loading || g.error || total === 0).map((g) => g.node)}
    </section>
  );
}
