import type { DatabaseBackend } from "./failover-topology";
import {
  resolvePartitionWritePair,
  type PartitionCapacityState,
  type PartitionReplicaPair,
} from "./storage-partitioning";

export type PartitionDataDomain = "facility" | "cards" | "personal" | "shared";

export type DomainWriteRoute = PartitionReplicaPair & {
  domain: PartitionDataDomain;
};

const DOMAIN_TABLES: Record<PartitionDataDomain, readonly string[]> = {
  facility: ["attendance", "service_sessions"],
  cards: ["treatment_cards", "card_top_ups", "card_usage_history"],
  personal: ["personal_services", "personal_sessions", "personal_settings"],
  shared: ["members", "member_versions", "service_types", "manager_grants", "appointments", "employee_availability", "facility_bonus_settings", "employee_service_bonus_rates", "tasks"],
};

const DOMAIN_ORDER: Record<PartitionDataDomain, readonly DatabaseBackend[]> = {
  facility: ["database_url_1", "database_url", "database_url_3", "database_url_4"],
  cards: ["database_url", "database_url_3", "database_url_4", "database_url_1"],
  personal: ["database_url_3", "database_url_4", "database_url", "database_url_1"],
  shared: ["database_url_4", "database_url_3", "database_url", "database_url_1"],
};

const ACTION_ENTITY_TYPES: Record<string, readonly string[]> = {
  "attendance.create": ["attendance"],
  "attendance.update": ["attendance"],
  "attendance.delete": ["attendance"],
  "appointment.create": ["appointments"],
  "appointment.update": ["appointments"],
  "appointment.delete": ["appointments"],
  "employee-availability.update": ["employee_availability"],
  "employee-bonus-config.update": ["facility_bonus_settings", "employee_service_bonus_rates"],
  "access-grant.create": ["manager_grants"],
  "access-grant.update": ["manager_grants"],
  "access-grant.delete": ["manager_grants"],
  "card.create": ["treatment_cards", "card_top_ups"],
  "card.update": ["treatment_cards"],
  "card.merge": ["treatment_cards", "card_top_ups"],
  "card.delete": ["treatment_cards"],
  "card.topup": ["treatment_cards", "card_top_ups"],
  "member.create": ["members", "member_versions"],
  "member.update": ["members", "member_versions"],
  "member.delete": ["members", "service_sessions", "attendance"],
  "personal-service.create": ["personal_services"],
  "personal-service.update": ["personal_services"],
  "personal-service.delete": ["personal_services"],
  "personal-session.create": ["personal_sessions"],
  "personal-session.update": ["personal_sessions"],
  "personal-session.delete": ["personal_sessions"],
  "personal-settings.update": ["personal_settings", "personal_services"],
  "personal-sync.replace": ["personal_services", "personal_sessions"],
  "retention.manual-delete-range": ["attendance", "service_sessions", "card_usage_history"],
  "retention.cleanup": ["attendance", "service_sessions", "card_usage_history", "personal_sessions"],
  "service-type.create": ["service_types"],
  "service-type.update": ["service_types"],
  "service-type.delete": ["service_types"],
  "service-session.save": ["service_sessions", "treatment_cards", "appointments"],
  "service-session.delete": ["service_sessions", "treatment_cards", "card_usage_history"],
};

const DOMAIN_BY_TABLE = new Map(
  Object.entries(DOMAIN_TABLES).flatMap(([domain, tables]) =>
    tables.map((table) => [table, domain as PartitionDataDomain] as const),
  ),
);
const ALL_AVAILABLE: ReadonlyMap<DatabaseBackend, PartitionCapacityState> = new Map([
  ["database_url_1", "available"],
  ["database_url", "available"],
  ["database_url_3", "available"],
  ["database_url_4", "available"],
]);

export function getPartitionDataDomain(table: string): PartitionDataDomain | undefined {
  return DOMAIN_BY_TABLE.get(table);
}

/** Tables potentially touched by a named API operation; unknown operations fail closed. */
export function getPartitionActionEntityTypes(action: string): readonly string[] | undefined {
  return ACTION_ENTITY_TYPES[action];
}

export function resolveDomainWriteRoutes(
  entityTypes: readonly string[],
  capacity: ReadonlyMap<DatabaseBackend, PartitionCapacityState>,
): Record<string, DomainWriteRoute> {
  const routes: Record<string, DomainWriteRoute> = {};
  for (const table of new Set(entityTypes)) {
    const domain = getPartitionDataDomain(table);
    if (!domain) throw new Error(`No storage domain is defined for ${table}.`);
    const pair = resolvePartitionWritePair(DOMAIN_ORDER[domain][0]!, DOMAIN_ORDER[domain], capacity);
    routes[table] = { ...pair, domain };
  }
  return routes;
}

/** Initial owner + neighboring copy, used before the operation's exact rows exist. */
export function getPreferredDomainWriteRoutes(
  entityTypes: readonly string[],
): Record<string, DomainWriteRoute> {
  return resolveDomainWriteRoutes(entityTypes, ALL_AVAILABLE);
}
