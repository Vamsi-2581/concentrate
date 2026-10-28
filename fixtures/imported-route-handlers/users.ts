export class UserStore {
  connect() {
    return process.env.USERS_DB_URL
  }

  get pageSize() {
    return Number(process.env['USERS_PAGE_SIZE'])
  }
}

export function listUsers(req, res) {
  const store = new UserStore()
  res.json({ db: store.connect(), limit: process.env.USERS_LIMIT })
}

export function createUser(req, res) {
  res.status(201).json({})
}
