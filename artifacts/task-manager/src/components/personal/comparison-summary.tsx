import type { PersonalComparisonVisit } from '@workspace/api-client-react';
import { visitGroups } from '@/lib/comparison-display';
import { formatMinutes, formatVnd } from '@/lib/massage';

export function ComparisonSummary({ title, visits, detailed = false }: { title: string; visits: PersonalComparisonVisit[]; detailed?: boolean }) {
  const minutes = visits.reduce((sum, v) => sum + v.minutes, 0);
  const pay = visits.reduce((sum, v) => sum + v.earnings, 0);
  return (
    <div className="cmp-col">
      <h4>{title}: {visits.length} ca</h4>
      <p className="mono">{formatMinutes(minutes)} · <strong>{formatVnd(pay)}</strong></p>
      {visits.length === 0 ? <span className="cmp-none">Không có ca</span> : (
        <ul className="p-list">
          {visitGroups(visits, detailed).map((group, i) => (
            <li key={i} className="cmp-visit">
              <strong>{group.service}: {group.count} ca</strong>
              <span>{detailed ? `${formatMinutes(group.eachMinutes)}/ca · ${formatVnd(group.eachPay)}/ca` : `${formatMinutes(group.minutes)} · ${formatVnd(group.earnings)}`}</span>
              {group.customer && <span>{group.customer}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
