import { sql } from "drizzle-orm";
import { db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { monthBounds, validDate } from "./massage";

/** User-defined report: recorded session pay plus card sales, not net profit. */
export async function getFacilityRevenue(month: string, requestedDate?: string) {
  const { start, end } = monthBounds(month);
  const date = validDate(requestedDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  // One SQL snapshot, with an independent subquery to avoid multiplying
  // sales or session earnings when multiple visits use the same card. The
  // singleton keeps a row even when no active cards were purchased this month.
  const [row] = await db.select({
    cardRevenue: sql<number>`coalesce((select sum(${treatmentCardsTable.purchaseAmount})
      from ${treatmentCardsTable} where ${treatmentCardsTable.purchaseDate} >= ${start}
        and ${treatmentCardsTable.purchaseDate} < ${end}
        and ${treatmentCardsTable.deletedAt} is null), 0)`,
    cardsSold: sql<number>`(select count(*) from ${treatmentCardsTable}
      where ${treatmentCardsTable.purchaseDate} >= ${start}
        and ${treatmentCardsTable.purchaseDate} < ${end}
        and ${treatmentCardsTable.deletedAt} is null)`,
    serviceRevenue: sql<number>`coalesce((
      select sum(${serviceSessionsTable.earnings}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and (${serviceSessionsTable.cardId} is null or exists (
          select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null
        ))
    ), 0)`,
    walkInServiceRevenue: sql<number>`coalesce((
      select sum(${serviceSessionsTable.earnings}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is null
    ), 0)`,
    walkInVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start} and ${serviceSessionsTable.workDate} < ${end}
      and ${serviceSessionsTable.cardId} is null)`,
    cardVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start} and ${serviceSessionsTable.workDate} < ${end}
      and ${serviceSessionsTable.cardId} is not null
      and exists (select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null))`,
    dayServiceRevenue: sql<number>`coalesce((select sum(${serviceSessionsTable.earnings})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and (${serviceSessionsTable.cardId} is null or exists (
        select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      ))), 0)`,
    dayWalkInServiceRevenue: sql<number>`coalesce((select sum(${serviceSessionsTable.earnings})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and ${serviceSessionsTable.cardId} is null), 0)`,
    dayCardRevenue: sql<number>`coalesce((select sum(${treatmentCardsTable.purchaseAmount})
      from ${treatmentCardsTable} where ${treatmentCardsTable.purchaseDate} = ${date}
      and ${treatmentCardsTable.deletedAt} is null), 0)`,
    dayCardsSold: sql<number>`(select count(*) from ${treatmentCardsTable}
      where ${treatmentCardsTable.purchaseDate} = ${date} and ${treatmentCardsTable.deletedAt} is null)`,
    dayWalkInVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} = ${date} and ${serviceSessionsTable.cardId} is null)`,
    dayCardVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} = ${date} and ${serviceSessionsTable.cardId} is not null
      and exists (select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null))`,
  }).from(sql`(select 1)`.as("summary_singleton"));
  const serviceRevenue = Number(row.serviceRevenue);
  const walkInServiceRevenue = Number(row.walkInServiceRevenue);
  const cardRevenue = Number(row.cardRevenue);
  const dayServiceRevenue = Number(row.dayServiceRevenue);
  const dayWalkInServiceRevenue = Number(row.dayWalkInServiceRevenue);
  const dayCardRevenue = Number(row.dayCardRevenue);
  return {
    month, revenue: serviceRevenue + cardRevenue, serviceRevenue, walkInServiceRevenue,
    revenueExcludingCardSessions: walkInServiceRevenue + cardRevenue, cardRevenue, cardsSold: Number(row.cardsSold),
    walkInVisits: Number(row.walkInVisits), cardVisits: Number(row.cardVisits),
    today: {
      date, revenue: dayServiceRevenue + dayCardRevenue, serviceRevenue: dayServiceRevenue,
      walkInServiceRevenue: dayWalkInServiceRevenue,
      revenueExcludingCardSessions: dayWalkInServiceRevenue + dayCardRevenue,
      cardRevenue: dayCardRevenue, cardsSold: Number(row.dayCardsSold),
      walkInVisits: Number(row.dayWalkInVisits), cardVisits: Number(row.dayCardVisits),
    },
  };
}
