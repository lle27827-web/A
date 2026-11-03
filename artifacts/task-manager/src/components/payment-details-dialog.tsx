import { useMemo } from 'react';
import {
  getGetPaymentDetailsQueryKey,
  useGetPaymentDetails,
} from '@workspace/api-client-react';
import type { GetPaymentDetailsParams } from '@workspace/api-client-react';
import { AlertCircle } from 'lucide-react';
import { Modal } from '@/components/modal';
import { formatShortDate } from '@/lib/attendance';
import { formatMinutes, formatMonth, formatVnd } from '@/lib/massage';
import './payment-details-dialog.css';

type Method = GetPaymentDetailsParams['method'];

export function PaymentDetailsDialog({ month, date, method, onClose }: {
  month: string;
  date?: string;
  method: Method;
  onClose: () => void;
}) {
  const params = useMemo(() => ({ month, ...(date ? { date } : {}), method }), [month, date, method]);
  const query = useGetPaymentDetails(params, {
    query: { queryKey: getGetPaymentDetailsQueryKey(params), staleTime: 20_000 },
  });
  const title = method === 'cash'
    ? 'Tiền mặt'
    : method === 'transfer'
      ? 'Chuyển khoản'
      : 'Chưa ghi phương thức';
  const period = date ? formatShortDate(date) : formatMonth(month);
  const total = query.data?.transactions.reduce((sum, item) => sum + item.amount, 0) ?? 0;

  return (
    <Modal title={`${title} · ${period}`} onClose={onClose} testId="dialog-payment-details">
      {query.isLoading ? <p role="status">Đang tải giao dịch…</p>
        : query.isError ? <p className="banner danger" role="alert"><AlertCircle size={15} />Không tải được chi tiết thanh toán.</p>
          : <>
            <div className="payment-details-total">
              <span>{query.data?.transactions.length ?? 0} giao dịch</span>
              <strong className="mono">{formatVnd(total)}</strong>
            </div>
            {query.data?.transactions.length
              ? <ul className="payment-detail-list" aria-label={`Chi tiết ${title.toLowerCase()} ${period}`}>
                  {query.data.transactions.map((item) => (
                    <li key={item.id} className="payment-detail-row" data-testid={`row-payment-detail-${item.id}`}>
                      <div className="payment-detail-heading">
                        <strong>{item.kind === 'walk_in_service' ? 'Dịch vụ khách lẻ' : item.kind === 'card_sale' ? 'Bán thẻ' : 'Nạp thẻ'}</strong>
                        <time dateTime={item.date}>{formatShortDate(item.date)}</time>
                      </div>
                      <p>{item.customerName} · {item.serviceType}</p>
                      {item.minutes !== null && <p className="muted">{formatMinutes(item.minutes)}{item.employeeName ? ` · Nhân viên ${item.employeeName}` : ''}</p>}
                      {item.sellerName && <p className="muted">Người bán: {item.sellerName}</p>}
                      <strong className="mono">{formatVnd(item.amount)}</strong>
                    </li>
                  ))}
                </ul>
              : <p className="empty payment-detail-empty">Không có giao dịch trong khoảng thời gian này.</p>}
          </>}
    </Modal>
  );
}
