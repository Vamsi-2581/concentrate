import express from 'express'
import { closeSessions, findAccount, openSession } from './drizzle/db'

const app = express()

app.get('/accounts/:id', async (req, res) => {
  res.json(await findAccount(Number(req.params.id)))
})

app.post('/sessions', async (req, res) => {
  res.json(await openSession(req.body.accountId))
})

app.delete('/sessions', async (req, res) => {
  await closeSessions(req.body.accountId)
  res.sendStatus(204)
})

export default app
