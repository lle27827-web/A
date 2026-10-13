import { and, gte, lt, sql } from "drizzle-orm";
import { db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { monthBounds } from "./massage";

/** User-defined report: recorded session pay plus card sales, not net profit. */
export async function getFacilityRevenue(month: string) {
  const { start, end } = monthBounds(month);
  // One SQL snapshot, with an independent subquery to avoid multiplying
  // sales or session earnings when multiple visits use the same card.
  const [row] = await db.select({
    cardRevenue: sql<number>`coalesce(sum(${treatmentCardsTable.purchaseAmount}), 0)`,
    cardsSold: sql<number>`count(*)`,
    serviceRevenue: sql<number>`coalesce((
      select sum(${serviceSessionsTable.earnings}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
    ), 0)`,
  }).from(treatmentCardsTable).where(and(
    gte(treatmentCardsTable.purchaseDate, start),
    lt(treatmentCardsTable.purchaseDate, end),
  ));
  const serviceRevenue = Number(row.serviceRevenue);
  const cardRevenue = Number(row.cardRevenue);
  return { month, revenue: serviceRevenue + cardRevenue, serviceRevenue, cardRevenue, cardsSold: Number(row.cardsSold) };
}
