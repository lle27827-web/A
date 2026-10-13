import { useMemo } from 'react';
import { getGetMassageSummaryQueryKey, useGetMassageSummary } from '@workspace/api-client-react';
import { ArrowRight, CreditCard, Users } from 'lucide-react';
import { Link } from 'wouter';
import { useShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/modal';
import { localDate } from '@/lib/attendance';
import { formatMonth, formatVnd, monthOf } from '@/lib/massage';

export default function HomePage() {
  const { query } = useShell();
  const month = monthOf(localDate());
  const summaryParams = useMemo(() => ({ month }), [month]);
  const summary = useGetMassageSummary(summaryParams, { query: { queryKey: getGetMassageSummaryQueryKey(summaryParams), refetchOnWindowFocus: true, staleTime: 20_000, refetchInterval: 60_000 } });

  // While searching, the shared SearchResults (mounted in AppShell) replaces the home tiles and report.
  if (query.trim()) return null;

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
