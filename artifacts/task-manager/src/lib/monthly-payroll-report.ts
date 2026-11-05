import type { MemberRecord, ServiceSession, ServiceTypeRecord } from '@workspace/api-client-react';

export type PayrollServiceColumn = {
  key: string;
  name: string;
  hourlyRates: number[];
};

export type PayrollCell = {
  sessions: number;
  minutes: number;
  earnings: number;
};

export type MonthlyPayrollRow = {
  memberId: number;
  employeeName: string;
  services: PayrollCell[];
  total: PayrollCell;
};

export type MonthlyPayrollReport = {
  services: PayrollServiceColumn[];
  rows: MonthlyPayrollRow[];
  total: PayrollCell;
};

const emptyCell = (): PayrollCell => ({ sessions: 0, minutes: 0, earnings: 0 });

function serviceNameKey(name: string): string {
  return name.trim().toLocaleLowerCase('vi');
}

function addSession(cell: PayrollCell, session: ServiceSession): void {
  cell.sessions += 1;
  cell.minutes += session.minutes;
  cell.earnings += session.earnings;
}

export function buildMonthlyPayrollReport(
  members: MemberRecord[],
  sessions: ServiceSession[],
  serviceTypes: ServiceTypeRecord[],
  month: string,
): MonthlyPayrollReport {
  const catalogById = new Map(serviceTypes.map((service) => [service.id, service]));
  const columns = new Map<string, PayrollServiceColumn>();

  for (const service of serviceTypes) {
    columns.set(`id:${service.id}`, { key: `id:${service.id}`, name: service.name, hourlyRates: [] });
  }

  const monthSessions = sessions.filter((session) =>
    session.workDate.startsWith(`${month}-`) && session.memberId !== null,
  );
  for (const session of monthSessions) {
    const key = session.serviceTypeId !== null
      ? `id:${session.serviceTypeId}`
      : `name:${serviceNameKey(session.serviceType)}`;
    if (!columns.has(key)) {
      const current = session.serviceTypeId === null ? undefined : catalogById.get(session.serviceTypeId);
      columns.set(key, { key, name: current?.name ?? session.serviceType, hourlyRates: [] });
    }
    const column = columns.get(key)!;
    if (Number.isFinite(session.hourlyRate) && !column.hourlyRates.includes(session.hourlyRate)) {
      column.hourlyRates.push(session.hourlyRate);
    }
  }

  for (const service of serviceTypes) {
    const column = columns.get(`id:${service.id}`);
    if (column && column.hourlyRates.length === 0 && Number.isFinite(service.hourlyRate)) {
      column.hourlyRates.push(service.hourlyRate);
    }
  }

  const serviceColumns = [...columns.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'vi') || a.key.localeCompare(b.key),
  );
  const serviceIndex = new Map(serviceColumns.map((service, index) => [service.key, index]));
  const memberById = new Map(members.map((member) => [member.id, member]));
  const rowsById = new Map<number, MonthlyPayrollRow>();

  for (const member of members) {
    rowsById.set(member.id, {
      memberId: member.id,
      employeeName: member.name,
      services: serviceColumns.map(emptyCell),
      total: emptyCell(),
    });
  }

  for (const session of monthSessions) {
    if (session.memberId === null) continue;
    let row = rowsById.get(session.memberId);
    if (!row) {
      row = {
        memberId: session.memberId,
        employeeName: session.employeeName,
        services: serviceColumns.map(emptyCell),
        total: emptyCell(),
      };
      rowsById.set(session.memberId, row);
    } else if (!memberById.has(session.memberId) && session.employeeName) {
      row.employeeName = session.employeeName;
    }

    const serviceKey = session.serviceTypeId !== null
      ? `id:${session.serviceTypeId}`
      : `name:${serviceNameKey(session.serviceType)}`;
    const index = serviceIndex.get(serviceKey);
    if (index !== undefined) addSession(row.services[index]!, session);
    addSession(row.total, session);
  }

  const rows = [...rowsById.values()].sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName, 'vi') || a.memberId - b.memberId,
  );
  const total = rows.reduce((sum, row) => ({
    sessions: sum.sessions + row.total.sessions,
    minutes: sum.minutes + row.total.minutes,
    earnings: sum.earnings + row.total.earnings,
  }), emptyCell());

  return { services: serviceColumns, rows, total };
}
