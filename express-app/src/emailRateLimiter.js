const IORedis = require('ioredis');
const { logger } = require('./logger');

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
       * This ensures the system gradually backs off during Redis outages,
       * reducing server load while maintaining eventual recovery capability.
       */
      retryStrategy(times) {
        const delay = Math.min(2000 * Math.pow(2, times), 30000);
        return delay;
      },
      /**
       * AUTO-RECONNECTION:
       * Enables automatic resubscription and connection recovery on transient errors.
       * Returns true to allow Redis client to automatically retry the connection.
       * This implements a basic resilience pattern, ensuring the system
       * attempts to recover from temporary Redis connectivity issues.
       */
      reconnectOnError(err) {
        logger && logger.warn && logger.warn('Redis reconnectOnError: %o', err.message || err);
        return true;
      }
    });

    redisClient.on('error', (err) => {
      logger && logger.error && logger.error('Redis error: %o', err);
    });
    redisClient.on('connect', () => {
      logger && logger.info && logger.info('Redis connected');
    });
    redisClient.on('ready', () => {
      logger && logger.info && logger.info('Redis ready');
    });
    redisClient.on('close', () => {
      logger && logger.warn && logger.warn('Redis connection closed');
    });
  }
  return redisClient;
}

/**
 * CIRCUIT BREAKER PATTERN - RATE LIMITING:
 * This function implements a circuit breaker via rate limiting using Redis.
 * 
 * @param {string} signature - Unique identifier for the error type (error message + path)
 * @param {number} windowMs - Time window for rate limiting (default: 600000ms = 10 minutes)
 * @param {number} max - Maximum number of emails allowed within the window (default: 3)
 * 
 * HOW IT WORKS:
 * 1. Uses Redis INCR to atomically count error occurrences
 * 2. Checks TTL to auto-reset counter after window expires
 * 3. Blocks email sending if threshold exceeded (circuit 'opens')
 * 4. Gracefully falls back to allowing emails if Redis is unavailable
 * 
 * This acts as a circuit breaker by preventing email flood during error storms,
 * protecting the email service from being overwhelmed.
 */
async function redisShouldSend(signature, windowMs = 600000, max = 3) {
  const r = getRedis();
  // Fallback to local behavior if Redis is unavailable (graceful degradation)
  if (!r) return true;
  try {
    const key = `${packageJson.name}-err:${signature}`;
    // Use Redis pipeline (multi) for atomic operation
    const tx = r.multi();
    tx.incr(key);
    tx.pttl(key);
    const results = await tx.exec();
    const count = results[0][1];
    const ttl = results[1][1];
    // Reset TTL if this is the first occurrence
    if (ttl === -1) {
      await r.pexpire(key, windowMs);
    }
    // Return true if under the limit (circuit still closed)
    return Number(count) <= Number(max);
  } catch (e) {
    // On Redis error, fallback to allowing email (circuit breaker recovers)
    logger && logger.warn && logger.warn('Redis limiter failed, allowing email: %o', e.message || e);
    return true;
  }
}

module.exports = { redisShouldSend };
