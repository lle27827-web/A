import { useParams } from 'wouter';
import { EmployeeDetail } from '@/components/employee-detail';

export default function EmployeePage() {
  const params = useParams<{ id: string }>();
  const n = Number(params.id);
  const id = Number.isInteger(n) && n > 0 ? n : -1;
  return <EmployeeDetail key={id} memberId={id} readOnly={false} />;
}
