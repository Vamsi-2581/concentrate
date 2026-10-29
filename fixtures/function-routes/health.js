function health(request, reply) {
  reply.send({ status: 'up' });
}

module.exports = function (fastify, options, next) {
  fastify.get('/health', health);
  next();
};
