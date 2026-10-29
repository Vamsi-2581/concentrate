const Fastify = require('fastify');

function createItem(request, reply) {
  reply.code(201).send(request.body);
}

function build(opts = {}) {
  const app = Fastify(opts);
  app.get('/', async () => ({ ok: true }));
  if (opts.items) {
    app.post('/items', createItem);
  }
  return app;
}

module.exports = build;
