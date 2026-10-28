import express from 'express'
import knex from 'knex'
import { PrismaClient } from '@prisma/client'
import { findUsers, renameUser } from './users'

const app = express()
const prisma = new PrismaClient()
const db = knex({ client: 'pg' })

app.get('/users', async (req, res) => {
  res.json(await findUsers())
})

app.patch('/users/:id', async (req, res) => {
  const user = await renameUser(Number(req.params.id), req.body.name)
  await knex('audit_log').insert({ action: 'rename', userId: user.id })
  res.json(user)
})

app.post('/posts', async (req, res) => {
  const post = await prisma.post.create({ data: req.body })
  res.status(201).json(post)
})

app.get('/stats', async (req, res) => {
  res.json(await prisma.postStats.findMany())
})

export default app
