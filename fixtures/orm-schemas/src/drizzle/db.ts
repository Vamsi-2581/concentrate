import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import { accounts, sessions } from './schema'

const db = drizzle(process.env.DATABASE_URL!)

export async function findAccount(id: number) {
  return db.select().from(accounts).where(eq(accounts.id, id))
}

export async function openSession(accountId: number) {
  await db.insert(sessions).values({ accountId })
  return db.query.accounts.findFirst()
}

export async function closeSessions(accountId: number) {
  await db.delete(sessions).where(eq(sessions.accountId, accountId))
}
