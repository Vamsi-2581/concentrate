import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function findUsers() {
  return prisma.user.findMany({ include: { posts: true } })
}

export async function renameUser(id: number, name: string) {
  return prisma.user.update({ where: { id }, data: { name } })
}
