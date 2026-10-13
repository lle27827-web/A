import { useParams, useSearch } from 'wouter';
import { EmployeeDetail } from '@/components/employee-detail';

export default function EmployeePage() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const n = Number(params.id);
  const id = Number.isInteger(n) && n > 0 ? n : -1;
  const date = new URLSearchParams(search).get('date');
  return <EmployeeDetail key={id} memberId={id} readOnly={false} initialDate={date} />;
}
