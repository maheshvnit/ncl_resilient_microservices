const Fastify = require('fastify');
const sendErrorEmail = require('./emailSender');

const fastify = Fastify({ logger: true });

fastify.get('/', async (request, reply) => {
  return { message: 'Hello from Fastify' };
});

fastify.get('/error', async (request, reply) => {
  throw new Error('Demo error from Fastify /error');
});

/**
 * GLOBAL ERROR HANDLER:
 * Catches all unhandled exceptions and sends notifications.
 * Implements graceful error response to client.
 */
fastify.setErrorHandler(async (error, request, reply) => {
  //fastify.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');
  try {
    /**
     * CIRCUIT BREAKER - RATE LIMITED EMAIL:
     * sendErrorEmail() internally applies rate limiting to prevent alert floods.
     * Configuration via ERROR_EMAIL_MAX and ERROR_EMAIL_WINDOW_MS env vars.
     */
    await sendErrorEmail(error, request);
  } catch (e) {
    // Silently log email send failures (don't halt response)
    fastify.log.error({ err: e }, 'Failed sending error email');
  }
  reply.status(500).send({ error: 'Internal Server Error' });
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3003;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Fastify server listening on ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
