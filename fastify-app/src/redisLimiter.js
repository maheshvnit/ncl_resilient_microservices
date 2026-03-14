const IORedis = require('ioredis');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
// import * as packageJson from '../package.json';
// import packageJson from '../package.json' assert { type: 'json' };
const packageJson = require('../package.json');

let redisClient = null;

function getRedis() {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    redisClient = new IORedis(url, {
      /**
       * RETRY STRATEGY:
       * Exponential backoff for failed connection attempts.
       * - Initial: 2s
       * - Doubles each retry
       * - Capped at 30s
       */
      retryStrategy(times) {
        const delay = Math.min(2000 * Math.pow(2, times), 30000);
        return delay;
      },
      reconnectOnError(err) {
        logger.warn('Redis reconnectOnError: %o', err && err.message ? err.message : err);
        return true;
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error: %o', err);
    });
    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });
    redisClient.on('ready', () => {
      logger.info('Redis ready');
    });
    redisClient.on('close', () => {
      logger.warn('Redis connection closed');
    });
  }
  return redisClient;
}

/**
 * CIRCUIT BREAKER PATTERN - REDIS-BACKED RATE LIMITING:
 * Distributed rate limiter used by fastify-app to prevent alert floods.
 * Returns `true` if an email is allowed (circuit closed), `false` when
 * the threshold has been exceeded (circuit open).  Falls back to allowing
 * emails if Redis is unreachable.
 */
async function redisShouldSend(signature, windowMs = 600000, max = 3) {
  const r = getRedis();
  if (!r) return true; // no configuration, allow
  try {
    const key = `${packageJson.name}-err:${signature}`;
    const tx = r.multi();
    tx.incr(key);
    tx.pttl(key);
    const results = await tx.exec();
    const count = results[0][1];
    const ttl = results[1][1];
    if (ttl === -1) {
      await r.pexpire(key, windowMs);
    }
    return Number(count) <= Number(max);
  } catch (e) {
    logger.warn('Redis limiter failed, allowing email: %o', e && e.message ? e.message : e);
    return true;
  }
}

module.exports = { redisShouldSend };
