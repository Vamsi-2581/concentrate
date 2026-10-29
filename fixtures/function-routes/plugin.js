const fastify = require('fastify')({ logger: true });

function listUsers(request, reply) {
  reply.send([]);
}

function users(instance, opts, done) {
  instance.get('/users', listUsers);
  done();
}

fastify.register(users, { prefix: '/v1' });

fastify.register(async (api) => {
  api.get('/status', listUsers);
}, { prefix: '/internal' });

fastify.listen({ port: 3000 });
