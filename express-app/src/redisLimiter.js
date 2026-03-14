const IORedis = require('ioredis');
//import * as packageJson from '../package.json';
const packageJson = require('../package.json');

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    redisClient = new IORedis(url, {
      /**
       * RETRY STRATEGY:
       * Implements exponential backoff for Redis reconnection attempts.
       * - Initial delay: 2000ms
       * - Doubles on each retry attempt
       * - Max delay capped at 30000ms (30 seconds)
       */
      retryStrategy(times) {
        const delay = Math.min(2000 * Math.pow(2, times), 30000);
        return delay;
      },
      /**
       * AUTO-RECONNECTION:
       * Enables automatic resubscription and connection recovery on transient errors.
       * Returns true to allow Redis client to automatically retry the connection.
       */
      reconnectOnError(err) {
        // no logger dependency; fallback to console
        console.warn('Redis reconnectOnError:', err && err.message ? err.message : err);
        return true;
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis error:', err);
    });
    redisClient.on('connect', () => {
      console.log('Redis connected');
    });
    redisClient.on('ready', () => {
      console.log('Redis ready');
    });
    redisClient.on('close', () => {
      console.warn('Redis connection closed');
    });
  }
  return redisClient;
}

/**
 * CIRCUIT BREAKER PATTERN - RATE LIMITING:
 * Redis-backed rate limiter. Returns `true` if an email is allowed (circuit closed),
 * `false` when threshold exceeded (circuit open). Gracefully allows emails on errors.
 */
async function redisShouldSend(signature, windowMs = 600000, max = 3) {
  const r = getRedis();
  if (!r) return true;
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
    console.warn('Redis limiter failed, allowing email:', e && e.message ? e.message : e);
    return true;
  }
}

module.exports = { redisShouldSend };