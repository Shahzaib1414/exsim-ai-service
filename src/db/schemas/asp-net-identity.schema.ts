import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── AspNetUsers ─────────────────────────────────────────────────────────────
export const users = pgTable('AspNetUsers', {
  id: text('Id').primaryKey(),

  // Identity base fields
  userName: varchar('UserName', { length: 256 }),
  normalizedUserName: varchar('NormalizedUserName', { length: 256 }),
  email: varchar('Email', { length: 256 }),
  normalizedEmail: varchar('NormalizedEmail', { length: 256 }),
  emailConfirmed: boolean('EmailConfirmed').notNull().default(false),
  passwordHash: text('PasswordHash'),
  securityStamp: text('SecurityStamp'),
  concurrencyStamp: text('ConcurrencyStamp'),
  phoneNumber: text('PhoneNumber'),
  phoneNumberConfirmed: boolean('PhoneNumberConfirmed')
    .notNull()
    .default(false),
  twoFactorEnabled: boolean('TwoFactorEnabled').notNull().default(false),
  lockoutEnd: timestamp('LockoutEnd', { withTimezone: true, mode: 'date' }),
  lockoutEnabled: boolean('LockoutEnabled').notNull().default(false),
  accessFailedCount: integer('AccessFailedCount').notNull().default(0),

  // Custom ApplicationUser fields
  firstName: text('FirstName'),
  lastName: text('LastName'),
  isActive: boolean('IsActive').notNull().default(true),
  imageUrl: text('ImageUrl'),
  status: text('Status').default('Pending'),
  isDeleted: boolean('IsDeleted').default(false),
  address: text('Address'),
  dob: text('DOB'),
  customerId: text('CustomerId'),
});

// ─── AspNetRoles ──────────────────────────────────────────────────────────────
export const roles = pgTable('AspNetRoles', {
  id: text('Id').primaryKey(),
  name: varchar('Name', { length: 256 }),
  normalizedName: varchar('NormalizedName', { length: 256 }),
  concurrencyStamp: text('ConcurrencyStamp'),
});

// ─── AspNetUserRoles ──────────────────────────────────────────────────────────
export const userRoles = pgTable(
  'AspNetUserRoles',
  {
    userId: text('UserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('RoleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

// ─── AspNetUserClaims ─────────────────────────────────────────────────────────
export const userClaims = pgTable('AspNetUserClaims', {
  id: integer('Id').primaryKey().generatedAlwaysAsIdentity(),
  userId: text('UserId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  claimType: text('ClaimType'),
  claimValue: text('ClaimValue'),
});

// ─── AspNetUserLogins ─────────────────────────────────────────────────────────
export const userLogins = pgTable(
  'AspNetUserLogins',
  {
    loginProvider: text('LoginProvider').notNull(),
    providerKey: text('ProviderKey').notNull(),
    providerDisplayName: text('ProviderDisplayName'),
    userId: text('UserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.loginProvider, t.providerKey] }),
  }),
);

// ─── AspNetUserTokens ─────────────────────────────────────────────────────────
export const userTokens = pgTable(
  'AspNetUserTokens',
  {
    userId: text('UserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loginProvider: text('LoginProvider').notNull(),
    name: text('Name').notNull(),
    value: text('Value'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.loginProvider, t.name] }),
  }),
);

// ─── AspNetRoleClaims ─────────────────────────────────────────────────────────
export const roleClaims = pgTable('AspNetRoleClaims', {
  id: integer('Id').primaryKey().generatedAlwaysAsIdentity(),
  roleId: text('RoleId')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  claimType: text('ClaimType'),
  claimValue: text('ClaimValue'),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
  claims: many(userClaims),
  logins: many(userLogins),
  tokens: many(userTokens),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  roleClaims: many(roleClaims),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));
