import { sql } from "drizzle-orm";
import {
  cardTopUpsTable,
  db,
  isPartitionedStorageEnabled,
  readPartitionedTable,
  serviceSessionsTable,
  treatmentCardsTable,
} from "@workspace/db";
import { MassageError, retainedDate, retainedMonthBounds } from "./massage";

/** Card-session wages remain in payroll but do not change this owner-defined revenue metric. */
function revenueTotals(walkInCharges: number, cardPayments: number, walkInWages: number) {
  const revenue = walkInCharges + cardPayments;
  return { revenue, netRevenue: revenue - walkInWages };
}

function amount(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function topService<T extends { serviceType: string }>(rows: T[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const serviceType = row.serviceType.trim();
    if (serviceType) counts.set(serviceType, (counts.get(serviceType) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))[0] ?? null;
}

function serviceBreakdown(rows: readonly { serviceType: string; minutes: number }[]) {
  const groups = new Map<string, { serviceType: string; minutes: number; visits: number }>();
  for (const row of rows) {
    const serviceType = row.serviceType.trim() || "Không tên";
    const key = `${serviceType}\u0000${row.minutes}`;
    const group = groups.get(key);
    if (group) group.visits += 1;
    else groups.set(key, { serviceType, minutes: row.minutes, visits: 1 });
  }
  return [...groups.values()].sort((a, b) =>
    a.serviceType.localeCompare(b.serviceType, "vi") || a.minutes - b.minutes,
  );
}

async function getPartitionedFacilityRevenue(month: string, date: string, start: string, end: string) {
  const [allCards, allTopUps, allSessions] = await Promise.all([
    readPartitionedTable("treatment_cards"),
    readPartitionedTable("card_top_ups"),
    readPartitionedTable("service_sessions"),
  ]);
  const cards = allCards as unknown as (typeof treatmentCardsTable.$inferSelect)[];
  const topUps = allTopUps as unknown as (typeof cardTopUpsTable.$inferSelect)[];
  const sessions = allSessions as unknown as (typeof serviceSessionsTable.$inferSelect)[];
  return aggregatePartitionedFacilityRevenue(month, date, start, end, cards, topUps, sessions);
}

type PartitionRevenueCard = Pick<
  typeof treatmentCardsTable.$inferSelect,
  "id" | "deletedAt" | "purchaseDate" | "purchaseAmount" | "purchasePaymentMethod" | "sellerName" | "serviceType" | "customerName" | "totalMinutes"
>;
type PartitionRevenueTopUp = Pick<
  typeof cardTopUpsTable.$inferSelect,
  "id" | "cardId" | "paymentDate" | "amount" | "paymentMethod" | "sellerName" | "source"
>;
type PartitionRevenueSession = Pick<
  typeof serviceSessionsTable.$inferSelect,
  "id" | "workDate" | "cardId" | "memberId" | "serviceType" | "customerName" | "employeeName" |
  "customerCharge" | "earnings" | "minutes" | "paymentMethod" | "isNightShift"
>;

export type PaymentMethodFilter = "cash" | "transfer" | "unrecorded";
type PaymentBucket = { total: number; walkInServices: number; cardSales: number; cardTopUps: number };
type PaymentBreakdown = Record<PaymentMethodFilter, PaymentBucket>;

function emptyPaymentBreakdown(): PaymentBreakdown {
  const empty = (): PaymentBucket => ({ total: 0, walkInServices: 0, cardSales: 0, cardTopUps: 0 });
  return { cash: empty(), transfer: empty(), unrecorded: empty() };
}

function paymentBucket(method: string | null | undefined): PaymentMethodFilter {
  return method === "cash" || method === "transfer" ? method : "unrecorded";
}

function addPayment(
  breakdown: PaymentBreakdown,
  method: string | null | undefined,
  kind: keyof Omit<PaymentBucket, "total">,
  value: unknown,
) {
  const amountValue = amount(value);
  const bucket = breakdown[paymentBucket(method)];
  bucket[kind] += amountValue;
  bucket.total += amountValue;
}

function aggregatePaymentBreakdown(
  sessions: readonly PartitionRevenueSession[],
  cards: readonly PartitionRevenueCard[],
  topUps: readonly PartitionRevenueTopUp[],
  start: string,
  end: string,
  date?: string,
): PaymentBreakdown {
  const inPeriod = (value: string) => value >= start && value < end && (!date || value === date);
  const result = emptyPaymentBreakdown();
  for (const row of sessions) {
    if (row.cardId === null && inPeriod(row.workDate)) {
      addPayment(result, row.paymentMethod, "walkInServices", row.customerCharge);
    }
  }
  for (const row of cards) {
    if (row.deletedAt === null && inPeriod(row.purchaseDate)) {
      addPayment(result, row.purchasePaymentMethod, "cardSales", row.purchaseAmount);
    }
  }
  const activeCardIds = new Set(cards.filter((card) => card.deletedAt === null).map((card) => card.id));
  for (const row of topUps) {
    if (activeCardIds.has(row.cardId) && inPeriod(row.paymentDate)) {
      addPayment(result, row.paymentMethod, row.source === "topup" ? "cardTopUps" : "cardSales", row.amount);
    }
  }
  return result;
}

export function aggregatePartitionedFacilityRevenue(
  month: string,
  date: string,
  start: string,
  end: string,
  cards: readonly PartitionRevenueCard[],
  topUps: readonly PartitionRevenueTopUp[],
  sessions: readonly PartitionRevenueSession[],
) {
  const activeCards = cards.filter((card) => card.deletedAt === null);
  const activeCardIds = new Set(activeCards.map((card) => card.id));
  const cardPayments = topUps.filter((topUp) => activeCardIds.has(topUp.cardId));
  const inMonth = (value: string) => value >= start && value < end;
  const monthSessions = sessions.filter((session) => inMonth(session.workDate));
  const daySessions = monthSessions.filter((session) => session.workDate === date);
  const monthWalkIns = monthSessions.filter((session) => session.cardId === null);
  const monthCardUses = monthSessions.filter((session) => session.cardId !== null && activeCardIds.has(session.cardId));
  const dayWalkIns = daySessions.filter((session) => session.cardId === null);
  const activeMonthSessions = [...monthWalkIns, ...monthCardUses];
  const activeDaySessions = [...dayWalkIns, ...daySessions.filter(
    (session) => session.cardId !== null && activeCardIds.has(session.cardId),
  )];
  const monthNightSessions = activeMonthSessions.filter((session) => session.isNightShift);
  const dayNightSessions = activeDaySessions.filter((session) => session.isNightShift);
  const sum = <T,>(rows: T[], select: (row: T) => unknown) =>
    rows.reduce((total, row) => total + amount(select(row)), 0);
  const monthCardSales = activeCards.filter((card) => inMonth(card.purchaseDate));
  const monthTopUps = cardPayments.filter((topUp) => inMonth(topUp.paymentDate));
  const dayCardSales = activeCards.filter((card) => card.purchaseDate === date);
  const dayTopUps = cardPayments.filter((topUp) => topUp.paymentDate === date);
  const monthlyPaymentBreakdown = aggregatePaymentBreakdown(sessions, cards, topUps, start, end);
  const dailyPaymentBreakdown = aggregatePaymentBreakdown(sessions, cards, topUps, start, end, date);
  const monthCardRevenue = sum(monthCardSales, (card) => card.purchaseAmount) +
    sum(monthTopUps, (topUp) => topUp.amount);
  const dayCardRevenue = sum(dayCardSales, (card) => card.purchaseAmount) +
    sum(dayTopUps, (topUp) => topUp.amount);
  const monthWalkInRevenue = sum(monthWalkIns, (session) => session.customerCharge);
  const dayWalkInRevenue = sum(dayWalkIns, (session) => session.customerCharge);
  const topSold = topService(monthCardSales);
  const mostUsedCard = topService(monthCardUses);
  const mostUsedWalkIn = topService(monthWalkIns);
  const mostUsedAll = topService([...monthCardUses, ...monthWalkIns]);

  return {
    month,
    ...revenueTotals(monthWalkInRevenue, monthCardRevenue, sum(monthWalkIns, (row) => row.earnings)),
    serviceRevenue: monthWalkInRevenue,
    walkInServiceRevenue: monthWalkInRevenue,
    walkInServiceMinutes: sum(monthWalkIns, (row) => row.minutes),
    payroll: sum(monthSessions, (row) => row.earnings),
    revenueExcludingCardSessions: monthWalkInRevenue + monthCardRevenue,
    cardRevenue: monthCardRevenue,
    cardsSold: monthCardSales.length,
    walkInVisits: monthWalkIns.length,
    cardVisits: monthCardUses.length,
    topSoldCardService: topSold ? { serviceType: topSold[0], cardsSold: topSold[1] } : null,
    mostUsedCardService: mostUsedCard
      ? {
          serviceType: mostUsedCard[0],
          visits: mostUsedCard[1],
          minutes: sum(monthCardUses.filter((row) => row.serviceType.trim() === mostUsedCard[0]), (row) => row.minutes),
        }
      : null,
    mostUsedWalkInService: mostUsedWalkIn
      ? { serviceType: mostUsedWalkIn[0], visits: mostUsedWalkIn[1] }
      : null,
    mostUsedService: mostUsedAll
      ? {
          serviceType: mostUsedAll[0],
          visits: mostUsedAll[1],
          minutes: sum(activeMonthSessions.filter((row) => row.serviceType.trim() === mostUsedAll[0]), (row) => row.minutes),
        }
      : null,
    serviceBreakdown: serviceBreakdown(activeMonthSessions),
    nightShiftBreakdown: serviceBreakdown(monthNightSessions),
    paymentBreakdown: monthlyPaymentBreakdown,
    today: {
      date,
      ...revenueTotals(dayWalkInRevenue, dayCardRevenue, sum(dayWalkIns, (row) => row.earnings)),
      serviceRevenue: dayWalkInRevenue,
      walkInServiceRevenue: dayWalkInRevenue,
      walkInServiceMinutes: sum(dayWalkIns, (row) => row.minutes),
      payroll: sum(daySessions, (row) => row.earnings),
      revenueExcludingCardSessions: dayWalkInRevenue + dayCardRevenue,
      cardRevenue: dayCardRevenue,
      cardsSold: dayCardSales.length,
      walkInVisits: dayWalkIns.length,
      cardVisits: daySessions.filter((row) => row.cardId !== null && activeCardIds.has(row.cardId)).length,
      serviceBreakdown: serviceBreakdown(activeDaySessions),
      nightShiftBreakdown: serviceBreakdown(dayNightSessions),
      paymentBreakdown: dailyPaymentBreakdown,
    },
  };
}

async function getPaymentBreakdowns(start: string, end: string, date: string) {
  const [sessions, sales, topUps] = await Promise.all([
    db.select({
      method: serviceSessionsTable.paymentMethod,
      month: sql<number>`coalesce(sum(${serviceSessionsTable.customerCharge}), 0)`,
      day: sql<number>`coalesce(sum(case when ${serviceSessionsTable.workDate} = ${date} then ${serviceSessionsTable.customerCharge} else 0 end), 0)`,
    }).from(serviceSessionsTable).where(sql`${serviceSessionsTable.cardId} is null
      and ${serviceSessionsTable.workDate} >= ${start} and ${serviceSessionsTable.workDate} < ${end}`)
      .groupBy(serviceSessionsTable.paymentMethod),
    db.select({
      method: treatmentCardsTable.purchasePaymentMethod,
      month: sql<number>`coalesce(sum(${treatmentCardsTable.purchaseAmount}), 0)`,
      day: sql<number>`coalesce(sum(case when ${treatmentCardsTable.purchaseDate} = ${date} then ${treatmentCardsTable.purchaseAmount} else 0 end), 0)`,
    }).from(treatmentCardsTable).where(sql`${treatmentCardsTable.deletedAt} is null
      and ${treatmentCardsTable.purchaseDate} >= ${start} and ${treatmentCardsTable.purchaseDate} < ${end}`)
      .groupBy(treatmentCardsTable.purchasePaymentMethod),
    db.select({
      method: cardTopUpsTable.paymentMethod,
      source: cardTopUpsTable.source,
      month: sql<number>`coalesce(sum(${cardTopUpsTable.amount}), 0)`,
      day: sql<number>`coalesce(sum(case when ${cardTopUpsTable.paymentDate} = ${date} then ${cardTopUpsTable.amount} else 0 end), 0)`,
    }).from(cardTopUpsTable).innerJoin(treatmentCardsTable,
      sql`${treatmentCardsTable.id} = ${cardTopUpsTable.cardId}`)
      .where(sql`${treatmentCardsTable.deletedAt} is null
        and ${cardTopUpsTable.paymentDate} >= ${start} and ${cardTopUpsTable.paymentDate} < ${end}`)
      .groupBy(cardTopUpsTable.paymentMethod, cardTopUpsTable.source),
  ]);
  const monthBreakdown = emptyPaymentBreakdown();
  const dayBreakdown = emptyPaymentBreakdown();
  for (const row of sessions) {
    addPayment(monthBreakdown, row.method, "walkInServices", row.month);
    addPayment(dayBreakdown, row.method, "walkInServices", row.day);
  }
  for (const row of sales) {
    addPayment(monthBreakdown, row.method, "cardSales", row.month);
    addPayment(dayBreakdown, row.method, "cardSales", row.day);
  }
  for (const row of topUps) {
    const category = row.source === "topup" ? "cardTopUps" : "cardSales";
    addPayment(monthBreakdown, row.method, category, row.month);
    addPayment(dayBreakdown, row.method, category, row.day);
  }
  return { monthBreakdown, dayBreakdown };
}

async function getServiceBreakdown(start: string, end: string, date?: string, nightOnly = false) {
  const period = date
    ? sql`${serviceSessionsTable.workDate} = ${date}`
    : sql`${serviceSessionsTable.workDate} >= ${start} and ${serviceSessionsTable.workDate} < ${end}`;
  const rows = await db.select({
    serviceType: serviceSessionsTable.serviceType,
    minutes: serviceSessionsTable.minutes,
    visits: sql<number>`count(*)`,
  }).from(serviceSessionsTable).where(sql`
    ${period}
    and (${nightOnly ? sql`${serviceSessionsTable.isNightShift} = true` : sql`true`})
    and (
      ${serviceSessionsTable.cardId} is null
      or exists (
        select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      )
    )
  `).groupBy(serviceSessionsTable.serviceType, serviceSessionsTable.minutes)
    .orderBy(serviceSessionsTable.serviceType, serviceSessionsTable.minutes);
  return rows.map((row) => ({
    serviceType: row.serviceType.trim() || "Không tên",
    minutes: row.minutes,
    visits: Number(row.visits),
  }));
}

/** Gross revenue recognizes walk-in service charges and card sales, not card redemptions. */
export async function getFacilityRevenue(month: string, requestedDate?: string) {
  const { start, end } = retainedMonthBounds(month);
  const date = retainedDate(requestedDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  if (isPartitionedStorageEnabled()) {
    return getPartitionedFacilityRevenue(month, date, start, end);
  }
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
  const mostUsedServiceType = sql<string | null>`(
    select ${serviceSessionsTable.serviceType}
    from ${serviceSessionsTable}
    where ${serviceSessionsTable.workDate} >= ${start}
      and ${serviceSessionsTable.workDate} < ${end}
      and ${serviceSessionsTable.serviceType} <> ''
      and (${serviceSessionsTable.cardId} is null or exists (
        select 1 from ${treatmentCardsTable}
        where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
          and ${treatmentCardsTable.deletedAt} is null
      ))
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
    mostUsedServiceType,
    mostUsedServiceVisits: sql<number>`coalesce((select count(*) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.serviceType} = ${mostUsedServiceType}
        and (${serviceSessionsTable.cardId} is null or exists (
          select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null
        ))), 0)`,
    mostUsedServiceMinutes: sql<number>`coalesce((select sum(${serviceSessionsTable.minutes}) from ${serviceSessionsTable}
      where ${serviceSessionsTable.workDate} >= ${start}
        and ${serviceSessionsTable.workDate} < ${end}
        and ${serviceSessionsTable.serviceType} = ${mostUsedServiceType}
        and (${serviceSessionsTable.cardId} is null or exists (
          select 1 from ${treatmentCardsTable}
          where ${treatmentCardsTable.id} = ${serviceSessionsTable.cardId}
            and ${treatmentCardsTable.deletedAt} is null
        ))), 0)`,
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
      from ${serviceSessionsTable} where ${serviceSessionsTable.workDate} = ${date}), 0)`,
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
  const mostUsedService = row.mostUsedServiceType ? {
    serviceType: row.mostUsedServiceType,
    visits: Number(row.mostUsedServiceVisits),
    minutes: Number(row.mostUsedServiceMinutes),
  } : null;
  const [
    monthlyServiceBreakdown,
    dailyServiceBreakdown,
    monthlyNightShiftBreakdown,
    dailyNightShiftBreakdown,
    paymentBreakdowns,
  ] = await Promise.all([
    getServiceBreakdown(start, end),
    getServiceBreakdown(start, end, date),
    getServiceBreakdown(start, end, undefined, true),
    getServiceBreakdown(start, end, date, true),
    getPaymentBreakdowns(start, end, date),
  ]);
  return {
    month, ...revenueTotals(walkInServiceRevenue, cardRevenue, walkInPayroll),
    serviceRevenue, walkInServiceRevenue, walkInServiceMinutes, payroll,
    revenueExcludingCardSessions: walkInServiceRevenue + cardRevenue, cardRevenue, cardsSold: Number(row.cardsSold),
    walkInVisits: Number(row.walkInVisits), cardVisits: Number(row.cardVisits),
    topSoldCardService, mostUsedCardService, mostUsedWalkInService, mostUsedService,
    serviceBreakdown: monthlyServiceBreakdown,
    nightShiftBreakdown: monthlyNightShiftBreakdown,
    paymentBreakdown: paymentBreakdowns.monthBreakdown,
    today: {
      date, ...revenueTotals(dayWalkInServiceRevenue, dayCardRevenue, dayWalkInPayroll),
      serviceRevenue: dayServiceRevenue,
      walkInServiceRevenue: dayWalkInServiceRevenue,
      walkInServiceMinutes: dayWalkInServiceMinutes,
      payroll: dayPayroll,
      revenueExcludingCardSessions: dayWalkInServiceRevenue + dayCardRevenue,
      cardRevenue: dayCardRevenue, cardsSold: Number(row.dayCardsSold),
      walkInVisits: Number(row.dayWalkInVisits), cardVisits: Number(row.dayCardVisits),
      serviceBreakdown: dailyServiceBreakdown,
      nightShiftBreakdown: dailyNightShiftBreakdown,
      paymentBreakdown: paymentBreakdowns.dayBreakdown,
    },
  };
}

type PaymentDetailItem = {
  id: string;
  kind: "walk_in_service" | "card_sale" | "card_topup";
  date: string;
  memberId: number | null;
  customerName: string;
  serviceType: string;
  employeeName: string | null;
  sellerName: string | null;
  minutes: number | null;
  amount: number;
  paymentMethod: string | null;
};

function methodMatches(value: string | null | undefined, selected: PaymentMethodFilter) {
  return paymentBucket(value) === selected;
}

function sortPaymentDetails(rows: PaymentDetailItem[]) {
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** Returns transaction-level detail only when a revenue viewer opens a tender row. */
export async function getPaymentDetails(month: string, requestedDate: string | undefined, method: PaymentMethodFilter) {
  const { start, end } = retainedMonthBounds(month);
  const date = requestedDate ? retainedDate(requestedDate) : null;
  if (date && !date.startsWith(`${month}-`)) {
    throw new MassageError(400, "Ngày lọc phải nằm trong tháng đã chọn.");
  }
  const inPeriod = (value: string) =>
    value >= start && value < end && (!date || value === date);

  if (isPartitionedStorageEnabled()) {
    const [cardRows, topUpRows, sessionRows] = await Promise.all([
      readPartitionedTable("treatment_cards"),
      readPartitionedTable("card_top_ups"),
      readPartitionedTable("service_sessions"),
    ]);
    const cards = cardRows as unknown as (typeof treatmentCardsTable.$inferSelect)[];
    const topUps = topUpRows as unknown as (typeof cardTopUpsTable.$inferSelect)[];
    const sessions = sessionRows as unknown as (typeof serviceSessionsTable.$inferSelect)[];
    const activeCards = cards.filter((card) => card.deletedAt === null);
    const cardById = new Map(activeCards.map((card) => [card.id, card]));
    const transactions: PaymentDetailItem[] = [];
    for (const session of sessions) {
      if (session.cardId !== null || !inPeriod(session.workDate) || !methodMatches(session.paymentMethod, method)) continue;
      transactions.push({
        id: `service:${session.id}`,
        kind: "walk_in_service",
        date: session.workDate,
        memberId: session.memberId,
        customerName: session.customerName || "Khách lẻ",
        serviceType: session.serviceType || "Không tên",
        employeeName: session.employeeName || null,
        sellerName: null,
        minutes: session.minutes,
        amount: Number(session.customerCharge),
        paymentMethod: session.paymentMethod,
      });
    }
    for (const card of activeCards) {
      if (!inPeriod(card.purchaseDate) || !methodMatches(card.purchasePaymentMethod, method)) continue;
      transactions.push({
        id: `card-sale:${card.id}`,
        kind: "card_sale",
        date: card.purchaseDate,
        memberId: null,
        customerName: card.customerName,
        serviceType: card.serviceType,
        employeeName: null,
        sellerName: card.sellerName,
        minutes: card.totalMinutes,
        amount: Number(card.purchaseAmount),
        paymentMethod: card.purchasePaymentMethod,
      });
    }
    for (const payment of topUps) {
      const card = cardById.get(payment.cardId);
      if (!card || !inPeriod(payment.paymentDate) || !methodMatches(payment.paymentMethod, method)) continue;
      transactions.push({
        id: `card-payment:${payment.id}`,
        kind: payment.source === "topup" ? "card_topup" : "card_sale",
        date: payment.paymentDate,
        memberId: null,
        customerName: card.customerName,
        serviceType: card.serviceType,
        employeeName: null,
        sellerName: payment.sellerName,
        minutes: payment.minutes,
        amount: Number(payment.amount),
        paymentMethod: payment.paymentMethod,
      });
    }
    return { month, date, method, transactions: sortPaymentDetails(transactions) };
  }

  const [sessions, sales, topUps] = await Promise.all([
    db.select().from(serviceSessionsTable).where(sql`${serviceSessionsTable.cardId} is null
      and ${serviceSessionsTable.workDate} >= ${start} and ${serviceSessionsTable.workDate} < ${end}`),
    db.select().from(treatmentCardsTable).where(sql`${treatmentCardsTable.deletedAt} is null
      and ${treatmentCardsTable.purchaseDate} >= ${start} and ${treatmentCardsTable.purchaseDate} < ${end}`),
    db.select({
      id: cardTopUpsTable.id,
      cardId: cardTopUpsTable.cardId,
      minutes: cardTopUpsTable.minutes,
      amount: cardTopUpsTable.amount,
      paymentDate: cardTopUpsTable.paymentDate,
      paymentMethod: cardTopUpsTable.paymentMethod,
      sellerName: cardTopUpsTable.sellerName,
      source: cardTopUpsTable.source,
      customerName: treatmentCardsTable.customerName,
      serviceType: treatmentCardsTable.serviceType,
      cardDeletedAt: treatmentCardsTable.deletedAt,
    }).from(cardTopUpsTable).innerJoin(treatmentCardsTable,
      sql`${treatmentCardsTable.id} = ${cardTopUpsTable.cardId}`)
      .where(sql`${treatmentCardsTable.deletedAt} is null
        and ${cardTopUpsTable.paymentDate} >= ${start} and ${cardTopUpsTable.paymentDate} < ${end}`),
  ]);
  const transactions: PaymentDetailItem[] = [];
  for (const session of sessions) {
    if (!inPeriod(session.workDate) || !methodMatches(session.paymentMethod, method)) continue;
    transactions.push({
      id: `service:${session.id}`,
      kind: "walk_in_service",
      date: session.workDate,
      memberId: session.memberId,
      customerName: session.customerName || "Khách lẻ",
      serviceType: session.serviceType || "Không tên",
      employeeName: session.employeeName || null,
      sellerName: null,
      minutes: session.minutes,
      amount: Number(session.customerCharge),
      paymentMethod: session.paymentMethod,
    });
  }
  for (const card of sales) {
    if (!inPeriod(card.purchaseDate) || !methodMatches(card.purchasePaymentMethod, method)) continue;
    transactions.push({
      id: `card-sale:${card.id}`,
      kind: "card_sale",
      date: card.purchaseDate,
      memberId: null,
      customerName: card.customerName,
      serviceType: card.serviceType,
      employeeName: null,
      sellerName: card.sellerName,
      minutes: card.totalMinutes,
      amount: Number(card.purchaseAmount),
      paymentMethod: card.purchasePaymentMethod,
    });
  }
  for (const payment of topUps) {
    if (!inPeriod(payment.paymentDate) || !methodMatches(payment.paymentMethod, method)) continue;
    transactions.push({
      id: `card-payment:${payment.id}`,
      kind: payment.source === "topup" ? "card_topup" : "card_sale",
      date: payment.paymentDate,
      memberId: null,
      customerName: payment.customerName,
      serviceType: payment.serviceType,
      employeeName: null,
      sellerName: payment.sellerName,
      minutes: payment.minutes,
      amount: Number(payment.amount),
      paymentMethod: payment.paymentMethod,
    });
  }
  return { month, date, method, transactions: sortPaymentDetails(transactions) };
}
