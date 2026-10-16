import { sql } from "drizzle-orm";
import { cardTopUpsTable, db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { monthBounds, validDate } from "./massage";

/** Gross revenue recognizes walk-in service charges and card sales, not card redemptions. */
export async function getFacilityRevenue(month: string, requestedDate?: string) {
  const { start, end } = monthBounds(month);
  const date = validDate(requestedDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  // One SQL snapshot, with independent subqueries to avoid multiplying
  // card sales, service charges, or payroll when multiple visits use a card. The
  // singleton keeps a row even when no active cards were purchased this month.
  const [row] = await db.select({
    cardRevenue: sql<number>`coalesce((select sum(${treatmentCardsTable.purchaseAmount})
      from ${treatmentCardsTable} where ${treatmentCardsTable.purchaseDate} >= ${start}
        and ${treatmentCardsTable.purchaseDate} < ${end}
        and ${treatmentCardsTable.deletedAt} is null), 0) + coalesce((
          select sum(${cardTopUpsTable.amount}) from ${cardTopUpsTable}
          inner join ${treatmentCardsTable} on ${treatmentCardsTable}."id" = ${cardTopUpsTable}."card_id"
          where ${cardTopUpsTable.paymentDate} >= ${start} and ${cardTopUpsTable.paymentDate} < ${end}
            and ${treatmentCardsTable.deletedAt} is null
        ), 0)`,
    cardsSold: sql<number>`(select count(*) from ${treatmentCardsTable}
      where ${treatmentCardsTable.purchaseDate} >= ${start}
        and ${treatmentCardsTable.purchaseDate} < ${end}
        and ${treatmentCardsTable.deletedAt} is null)`,
    serviceRevenue: sql<number>`coalesce((
      select sum(${serviceSessionsTable.customerCharge}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is null
    ), 0)`,
    walkInServiceRevenue: sql<number>`coalesce((
      select sum(${serviceSessionsTable.customerCharge}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is null
    ), 0)`,
    payroll: sql<number>`coalesce((
      select sum(${serviceSessionsTable.earnings}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and (${serviceSessionsTable.cardId} is null or exists (
          select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null
        ))
    ), 0)`,
    walkInServiceMinutes: sql<number>`coalesce((
      select sum(${serviceSessionsTable.minutes}) from ${serviceSessionsTable}
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
    dayServiceRevenue: sql<number>`coalesce((select sum(${serviceSessionsTable.customerCharge})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and ${serviceSessionsTable.cardId} is null), 0)`,
    dayWalkInServiceRevenue: sql<number>`coalesce((select sum(${serviceSessionsTable.customerCharge})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and ${serviceSessionsTable.cardId} is null), 0)`,
    dayPayroll: sql<number>`coalesce((select sum(${serviceSessionsTable.earnings})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and (${serviceSessionsTable.cardId} is null or exists (
        select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      ))), 0)`,
    dayWalkInServiceMinutes: sql<number>`coalesce((select sum(${serviceSessionsTable.minutes})
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}
      and ${serviceSessionsTable.cardId} is null), 0)`,
    dayCardRevenue: sql<number>`coalesce((select sum(${treatmentCardsTable.purchaseAmount})
      from ${treatmentCardsTable} where ${treatmentCardsTable.purchaseDate} = ${date}
      and ${treatmentCardsTable.deletedAt} is null), 0) + coalesce((
        select sum(${cardTopUpsTable.amount}) from ${cardTopUpsTable}
        inner join ${treatmentCardsTable} on ${treatmentCardsTable}."id" = ${cardTopUpsTable}."card_id"
        where ${cardTopUpsTable.paymentDate} = ${date} and ${treatmentCardsTable.deletedAt} is null
      ), 0)`,
    dayCardsSold: sql<number>`(select count(*) from ${treatmentCardsTable}
      where ${treatmentCardsTable.purchaseDate} = ${date} and ${treatmentCardsTable.deletedAt} is null)`,
    dayWalkInVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} = ${date} and ${serviceSessionsTable.cardId} is null)`,
    dayCardVisits: sql<number>`(select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} = ${date} and ${serviceSessionsTable.cardId} is not null
      and exists (select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null))`,
  }).from(sql`(select 1)`);
  const serviceRevenue = Number(row.serviceRevenue);
  const walkInServiceRevenue = Number(row.walkInServiceRevenue);
  const walkInServiceMinutes = Number(row.walkInServiceMinutes);
  const cardRevenue = Number(row.cardRevenue);
  const payroll = Number(row.payroll);
  const dayServiceRevenue = Number(row.dayServiceRevenue);
  const dayWalkInServiceRevenue = Number(row.dayWalkInServiceRevenue);
  const dayWalkInServiceMinutes = Number(row.dayWalkInServiceMinutes);
  const dayCardRevenue = Number(row.dayCardRevenue);
  const dayPayroll = Number(row.dayPayroll);
  return {
    month, revenue: serviceRevenue + cardRevenue, netRevenue: serviceRevenue + cardRevenue - payroll,
    serviceRevenue, walkInServiceRevenue, walkInServiceMinutes, payroll,
    revenueExcludingCardSessions: walkInServiceRevenue + cardRevenue, cardRevenue, cardsSold: Number(row.cardsSold),
    walkInVisits: Number(row.walkInVisits), cardVisits: Number(row.cardVisits),
    today: {
      date, revenue: dayServiceRevenue + dayCardRevenue,
      netRevenue: dayServiceRevenue + dayCardRevenue - dayPayroll, serviceRevenue: dayServiceRevenue,
      walkInServiceRevenue: dayWalkInServiceRevenue,
      walkInServiceMinutes: dayWalkInServiceMinutes,
      payroll: dayPayroll,
      revenueExcludingCardSessions: dayWalkInServiceRevenue + dayCardRevenue,
      cardRevenue: dayCardRevenue, cardsSold: Number(row.dayCardsSold),
      walkInVisits: Number(row.dayWalkInVisits), cardVisits: Number(row.dayCardVisits),
    },
  };
}
