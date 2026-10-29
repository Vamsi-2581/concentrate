import { integer, pgTable, serial, text } from 'drizzle-orm/pg-core'

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  bio: text('bio'),
})

export const sessions = pgTable('sessions', {
  id: serial().primaryKey(),
  accountId: integer('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
})
