function authenticate(req, res, next) {
  if (!process.env.AUTH_SECRET) return res.status(401).end()
  next()
}

module.exports = { authenticate }
