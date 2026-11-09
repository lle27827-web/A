import { appointmentsTable, serviceSessionsTable, treatmentCardsTable, type MutationDraft } from "@workspace/db";
import { identityText, validIdentityPhone } from "./massage-common";
import { deleteMutation } from "./partitioned-mutations";

export function sessionResponse(row: typeof serviceSessionsTable.$inferSelect) {
  return { ...row, archived: false, createdAt: row.createdAt.toISOString() };
}

export function resolveSessionHourlyRate(
  oldRate: number | undefined,
  currentServiceRate: number | undefined,
  sameService: boolean,
): number {
  if (sameService && oldRate !== undefined && oldRate > 0) return oldRate;
  return currentServiceRate ?? 0;
}

export function resolveSessionCustomerHourlyRate(
  oldRate: number | undefined,
  currentServiceRate: number | undefined,
  sameService: boolean,
): number {
  if (sameService && oldRate !== undefined && oldRate > 0) return oldRate;
  return currentServiceRate ?? 0;
}

export function buildPartitionedSessionDeleteMutations(id: number): MutationDraft[] {
  return [deleteMutation("service_sessions", id)];
}

export function serviceTypeHasHistory(
  serviceTypeId: number,
  sessions: readonly { serviceTypeId: number | null }[],
  archivedUses: readonly { serviceTypeId: number | null }[],
): boolean {
  return sessions.some((row) => row.serviceTypeId === serviceTypeId) ||
    archivedUses.some((row) => row.serviceTypeId === serviceTypeId);
}

export function sameAppointmentCustomer(
  appointment: Pick<typeof appointmentsTable.$inferSelect, "customerName" | "phone">,
  card: Pick<typeof treatmentCardsTable.$inferSelect, "customerName" | "phone">,
) {
  const appointmentName = identityText(appointment.customerName);
  const cardName = identityText(card.customerName);
  const appointmentPhone = validIdentityPhone(appointment.phone);
  const cardPhone = validIdentityPhone(card.phone);
  return Boolean(appointmentName && cardName && appointmentName === cardName) ||
    Boolean(appointmentPhone && cardPhone && appointmentPhone === cardPhone);
}
