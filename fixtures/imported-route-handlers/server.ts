import express from 'express'
import { listUsers, createUser as addUser } from './users'

const { authenticate } = require('./auth')

const app = express()

function audit(req, res, next) {
  next()
}

app.get('/users', listUsers)
app.post('/users', authenticate, audit, addUser)
app.use(authenticate)
app.get('/health', audit, (req, res) => res.send('ok'))
