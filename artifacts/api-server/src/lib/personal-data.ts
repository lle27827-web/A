import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { db, personalServicesTable as services, personalSettingsTable as settings, serviceTypesTable } from "@workspace/db";

export type PersonalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function lockPersonal(tx: PersonalTx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'personal:' + userId}, 0))`);
}
export async function personalSettings(tx: PersonalTx, userId: string) {
  const [row] = await tx.select().from(settings).where(eq(settings.userId, userId));
  return { useFacilityRates: row?.useFacilityRates ?? false };
}
/** Mirror only service names and employee pay rates, never customer prices. */
export async function refreshFacilityServices(tx: PersonalTx, userId: string) {
  const catalog = await tx.select({ id: serviceTypesTable.id, name: serviceTypesTable.name, hourlyRate: serviceTypesTable.hourlyRate })
    .from(serviceTypesTable);
  for (const item of catalog) {
    await tx.insert(services).values({ userId, facilityServiceId: item.id, name: item.name, hourlyRate: item.hourlyRate })
      .onConflictDoUpdate({ target: [services.userId, services.facilityServiceId],
        set: { name: item.name, hourlyRate: item.hourlyRate, deletedAt: null } });
  }
  await tx.update(services).set({ deletedAt: new Date() }).where(and(eq(services.userId, userId),
    isNotNull(services.facilityServiceId), catalog.length ? notInArray(services.facilityServiceId, catalog.map((s) => s.id)) : undefined));
}
