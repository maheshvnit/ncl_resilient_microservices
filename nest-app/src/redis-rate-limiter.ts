const IORedis = require('ioredis');

import * as packageJson from './../package.json';

let client: any = null;
/**
 * REDIS CLIENT WITH RETRY MECHANISM:
 * Singleton pattern ensures only one Redis connection.
 * Implements exponential backoff for connection resilience.
 */
export function getRedisClient() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    client = new IORedis(url, {
      /**
       * RETRY STRATEGY - EXPONENTIAL BACKOFF:
       * Implements progressive backoff for failed connection attempts.
       * - Attempt 1: 2000ms
       * - Attempt 2: 4000ms
       * - Attempt 3: 8000ms
       * - Attempt 4+: Capped at 30000ms (30 seconds)
       * 
       * This prevents rapid reconnection storms during Redis outages,
       * gradually backing off while maintaining recovery capability.
       */
      retryStrategy(times: number) {
        // exponential backoff: 2^times * 2000ms, capped at 30s
        return Math.min(2000 * Math.pow(2, times), 30000);
      }
    });

    /**
     * EVENT LISTENERS FOR CONNECTION LIFECYCLE:
     * Monitor Redis connection state for observability.
     */
    client.on('error', (err: any) => {
      // Log errors but continue operating (graceful degradation)
      const msg = err && (err as any).message ? (err as any).message : String(err);
      console.error('Redis error:', msg);
    });
    client.on('connect', () => console.info('Redis connecting')); // Retry in progress
    client.on('ready', () => console.info('Redis ready')); // Connection established
    client.on('close', () => console.warn('Redis connection closed')); // Unexpected disconnect
  }
  return client;
}

/**
 * CIRCUIT BREAKER PATTERN - REDIS-BACKED RATE LIMITING:
 * Distributed rate limiter for preventing email alert floods across multiple instances.
 * 
 * @param {string} signature - Unique error identifier for deduplication
 * @param {number} windowMs - Time window for rate limiting (default: 600000ms = 10 min)
 * @param {number} max - Max allowed emails per signature in window (default: 3)
 * @returns {boolean} true if email should be sent (circuit closed), false if blocked (circuit open)
 * 
 * CIRCUIT BREAKER BEHAVIOR:
 * - CLOSED: Normal operation, emails are sent when under limit
 * - OPEN: During error storm, emails blocked after max reached
 * - HALF-OPEN: Window expires, counter resets, circuit closes again
 * 
 * DISTRIBUTED SAFETY:
 * Uses Redis INCR for atomic counter operations across multiple app instances.
 * PEXPIRE ensures automatic cleanup of old error entries.
 */
export async function redisShouldSend(signature: string, windowMs = 600000, max = 3) {
  const r = getRedisClient();
  // Graceful degradation: allow emails if Redis unavailable
  if (!r) return true;
  try {
    const key = `${packageJson.name}-err:${signature}`;
    // Atomic pipeline: increment counter and check TTL
    const tx = r.multi();
    tx.incr(key);
    tx.pttl(key);
    const results = await tx.exec();
    const count = results[0][1];
    const ttl = results[1][1];
    // Set expiration on first occurrence
    if (ttl === -1) {
      await r.pexpire(key, windowMs);
    }
    // Return true if under threshold (circuit remains closed)
    return Number(count) <= Number(max);
  } catch (e) {
    // On Redis failure: fallback to allowing emails (circuit breaker failure mode)
    const msg = e && (e as any).message ? (e as any).message : String(e);
    console.warn('Redis limiter failed, allowing email:', msg);
    return true;
  }
}
