import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Business registry and memberships are stored on the DB3 coordinator only.
 * Business rows are addressed by UUID; join codes are stored as hashes only.
 */
export const businessesTable = pgTable("businesses", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  ownerEmail: text("owner_email").notNull(),
  joinCodeHash: text("join_code_hash").notNull(),
  joinCodeHashVersion: text("join_code_hash_version").notNull().default("sha256"),
  facilityName: text("facility_name").notNull().default(""),
  facilityAddress: text("facility_address").notNull().default(""),
  facilityTaxCode: text("facility_tax_code").notNull().default(""),
  facilityPhone: text("facility_phone").notNull().default(""),
  printProfileUpdatedAt: timestamp("print_profile_updated_at", { withTimezone: true }).notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("businesses_join_code_hash_unique").on(table.joinCodeHash),
  index("businesses_owner_user_idx").on(table.ownerUserId),
]);

export const businessUsersTable = pgTable("business_users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("business_users_email_idx").on(table.email),
]);

export const businessMembershipsTable = pgTable("business_memberships", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businessesTable.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => businessUsersTable.userId, { onDelete: "restrict" }),
  email: text("email").notNull(),
  role: text("role").$type<"owner" | "employee">().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("business_memberships_business_user_unique").on(table.businessId, table.userId),
  uniqueIndex("business_memberships_business_email_unique").on(table.businessId, table.email),
  index("business_memberships_user_active_idx").on(table.userId, table.active),
]);

export const businessJoinAttemptsTable = pgTable("business_join_attempts", {
  id: uuid("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("business_join_attempts_key_time_idx").on(table.keyHash, table.attemptedAt),
  index("business_join_attempts_time_idx").on(table.attemptedAt),
]);

export type Business = typeof businessesTable.$inferSelect;
export type BusinessMembership = typeof businessMembershipsTable.$inferSelect;
