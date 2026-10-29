import { identityPhone } from "./massage";

export function maskCustomerPhone(phone: string): string {
  return `•••••••${phone.replace(/\D/g, "").slice(-3)}`;
}

export function isMaskedCustomerPhone(phone: unknown): phone is string {
  return typeof phone === "string" && /^•{7}\d{0,3}$/.test(phone);
}

export function matchesTreatmentCardSearch(
  card: { customerName: string; phone: string; serviceType: string },
  query: string,
): boolean {
  const search = query.trim();
  if (!search) return true;
  const normalized = (value: string) =>
    value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  if (normalized(card.customerName).includes(normalized(search)) ||
      normalized(card.serviceType).includes(normalized(search))) return true;

  if (!/^[\d\s()+.-]+$/.test(search)) return false;
  const digits = identityPhone(search);
  return digits.length > 0 && identityPhone(card.phone).includes(digits);
}
