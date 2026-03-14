const { logger, sendErrorEmail } = require('./logger');
const { redisShouldSend } = require('./redisLimiter');
//import * as packageJson from '../package.json';
const packageJson = require('../package.json');

/**
 * GLOBAL ERROR HANDLER:
 * Implements resilient error handling with email notification and rate limiting.
 */
async function errorHandler(err, req, res, next) {
  // Log full error with timestamp
  //logger.error('Unhandled error: %o', err);

  // check distributed limiter before even attempting to send
  try {
    const sig = `${packageJson.name}-` + (err.message || '') + '|' + ((err.stack||'').split('\n')[0] || '');
    const allowed = await redisShouldSend(sig, Number(process.env.ERROR_EMAIL_WINDOW_MS || 600000), Number(process.env.ERROR_EMAIL_MAX || 3));
    if (!allowed) {
      logger.warn('Error email rate-limited (pre-check) for signature: %s', sig);
      // skip sending
      const status = err.status || 500;
      return res.status(status).json({ error: err.message || 'Internal Server Error' });
    }
  } catch (e) {
    // ignore redis errors and proceed with send
  }

  /**
   * FIRE-AND-FORGET EMAIL:
   * Sends error notification asynchronously via sendErrorEmail().
   * Rate limiting (circuit breaker) is applied within sendErrorEmail() to prevent email flood.
   * .catch(() => {}) silently fails email sending to avoid halting HTTP response.
   */
  sendErrorEmail(err, req).catch(() => {});

  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
}

module.exports = errorHandler;
