import { sql } from "drizzle-orm";
import { cardTopUpsTable, db, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { monthBounds, validDate } from "./massage";

/** Card-session wages remain in payroll but do not change this owner-defined revenue metric. */
function revenueTotals(walkInCharges: number, cardPayments: number, walkInWages: number) {
  const revenue = walkInCharges + cardPayments;
  return { revenue, netRevenue: revenue - walkInWages };
}

/** Gross revenue recognizes walk-in service charges and card sales, not card redemptions. */
export async function getFacilityRevenue(month: string, requestedDate?: string) {
  const { start, end } = monthBounds(month);
  const date = validDate(requestedDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  const topSoldCardServiceType = sql<string | null>`(
    select ${treatmentCardsTable.serviceType}
    from ${treatmentCardsTable}
    where ${treatmentCardsTable.purchaseDate} >= ${start}
      and ${treatmentCardsTable.purchaseDate} < ${end}
      and ${treatmentCardsTable.deletedAt} is null
      and ${treatmentCardsTable.serviceType} <> ''
    group by ${treatmentCardsTable.serviceType}
    order by count(*) desc, ${treatmentCardsTable.serviceType} asc
    limit 1
  )`;
  const mostUsedCardServiceType = sql<string | null>`(
    select ${serviceSessionsTable.serviceType}
    from ${serviceSessionsTable}
    where ${serviceSessionsTable.workDate} >= ${start}
      and ${serviceSessionsTable.workDate} < ${end}
      and ${serviceSessionsTable.cardId} is not null
      and ${serviceSessionsTable.serviceType} <> ''
      and exists (
        select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      )
    group by ${serviceSessionsTable.serviceType}
    order by count(*) desc, ${serviceSessionsTable.serviceType} asc
    limit 1
  )`;
  const mostUsedWalkInServiceType = sql<string | null>`(
    select ${serviceSessionsTable.serviceType}
    from ${serviceSessionsTable}
    where ${serviceSessionsTable.workDate} >= ${start}
      and ${serviceSessionsTable.workDate} < ${end}
      and ${serviceSessionsTable.cardId} is null
      and ${serviceSessionsTable.serviceType} <> ''
    group by ${serviceSessionsTable.serviceType}
    order by count(*) desc, ${serviceSessionsTable.serviceType} asc
    limit 1
  )`;
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
    topSoldCardServiceType,
    topSoldCardCount: sql<number>`coalesce((select count(*) from ${treatmentCardsTable}
      where ${treatmentCardsTable.purchaseDate} >= ${start}
        and ${treatmentCardsTable.purchaseDate} < ${end}
        and ${treatmentCardsTable.deletedAt} is null
        and ${treatmentCardsTable.serviceType} = ${topSoldCardServiceType}), 0)`,
    mostUsedCardServiceType,
    mostUsedCardVisits: sql<number>`coalesce((select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is not null
        and ${serviceSessionsTable.serviceType} = ${mostUsedCardServiceType}
        and exists (select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null)), 0)`,
    mostUsedCardMinutes: sql<number>`coalesce((select sum(${serviceSessionsTable.minutes}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is not null
        and ${serviceSessionsTable.serviceType} = ${mostUsedCardServiceType}
        and exists (select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null)), 0)`,
    mostUsedWalkInServiceType,
    mostUsedWalkInServiceVisits: sql<number>`coalesce((select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.cardId} is null
        and ${serviceSessionsTable.serviceType} = ${mostUsedWalkInServiceType}), 0)`,
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
    walkInPayroll: sql<number>`coalesce((
      select sum(${serviceSessionsTable.earnings}) from ${serviceSessionsTable}
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
    dayWalkInPayroll: sql<number>`coalesce((select sum(${serviceSessionsTable.earnings})
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
  const walkInPayroll = Number(row.walkInPayroll);
  const dayServiceRevenue = Number(row.dayServiceRevenue);
  const dayWalkInServiceRevenue = Number(row.dayWalkInServiceRevenue);
  const dayWalkInServiceMinutes = Number(row.dayWalkInServiceMinutes);
  const dayCardRevenue = Number(row.dayCardRevenue);
  const dayPayroll = Number(row.dayPayroll);
  const dayWalkInPayroll = Number(row.dayWalkInPayroll);
  const topSoldCardService = row.topSoldCardServiceType ? {
    serviceType: row.topSoldCardServiceType,
    cardsSold: Number(row.topSoldCardCount),
  } : null;
  const mostUsedCardService = row.mostUsedCardServiceType ? {
    serviceType: row.mostUsedCardServiceType,
    visits: Number(row.mostUsedCardVisits),
    minutes: Number(row.mostUsedCardMinutes),
  } : null;
  const mostUsedWalkInService = row.mostUsedWalkInServiceType ? {
    serviceType: row.mostUsedWalkInServiceType,
    visits: Number(row.mostUsedWalkInServiceVisits),
  } : null;
  return {
    month, ...revenueTotals(walkInServiceRevenue, cardRevenue, walkInPayroll),
    serviceRevenue, walkInServiceRevenue, walkInServiceMinutes, payroll,
    revenueExcludingCardSessions: walkInServiceRevenue + cardRevenue, cardRevenue, cardsSold: Number(row.cardsSold),
    walkInVisits: Number(row.walkInVisits), cardVisits: Number(row.cardVisits),
    topSoldCardService, mostUsedCardService, mostUsedWalkInService,
    today: {
      date, ...revenueTotals(dayWalkInServiceRevenue, dayCardRevenue, dayWalkInPayroll),
      serviceRevenue: dayServiceRevenue,
      walkInServiceRevenue: dayWalkInServiceRevenue,
      walkInServiceMinutes: dayWalkInServiceMinutes,
      payroll: dayPayroll,
      revenueExcludingCardSessions: dayWalkInServiceRevenue + dayCardRevenue,
      cardRevenue: dayCardRevenue, cardsSold: Number(row.dayCardsSold),
      walkInVisits: Number(row.dayWalkInVisits), cardVisits: Number(row.dayCardVisits),
    },
  };
}
