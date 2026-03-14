const { createLogger, format, transports } = require('winston');
const nodemailer = require('nodemailer');
//import * as packageJson from '../package.json';
const packageJson = require('../package.json');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [new transports.Console({ format: format.simple() })]
});

logger.stream = {
  write: (message) => logger.info(message.trim())
};

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 1025,
  secure: false,
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
});
// Template loader and simple placeholder renderer
const fs = require('fs');
const path = require('path');
const TEMPLATE_PATH = process.env.ERROR_EMAIL_TEMPLATE || path.join(process.cwd(), 'templates/error_email.html');
console.log('Using error email template:', TEMPLATE_PATH);
const { redisShouldSend } = require('./redisLimiter');
let templateCache = null;
function loadTemplate() {
  if (templateCache) return templateCache;
  try {
    templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (e) {
    console.error('Using error email template:', e);
    templateCache = '<pre>{{STACK}}</pre>';
  }
  return templateCache;
}

function renderTemplate(tpl, data) {
  return tpl.replace(/{{(\w+)}}/g, (_, key) => {
    const v = data[key] !== undefined ? data[key] : '';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

/**
 * CIRCUIT BREAKER PATTERN - LOCAL RATE LIMITING:
 * In-memory rate limiter as fallback when Redis is unavailable.
 * Protects email service from alert fatigue during error storms.
 */
const emailSentMap = new Map();
const WINDOW_MS = Number(process.env.ERROR_EMAIL_WINDOW_MS || 600000); // Default: 10 minutes
const MAX_PER_WINDOW = Number(process.env.ERROR_EMAIL_MAX || 3); // Max 3 emails per window

/**
 * LOCAL CIRCUIT BREAKER:
 * Tracks error email frequency in memory.
 * When max threshold is reached within window, circuit 'opens' and blocks further emails.
 * Resets automatically when window expires.
 */
function shouldSendEmail(signature) {
  const now = Date.now();
  const entry = emailSentMap.get(signature) || { count: 0, start: now };
  // Window expired: reset counter
  if (now - entry.start > WINDOW_MS) {
    emailSentMap.set(signature, { count: 1, start: now });
    return true;
  }
  // Within limit: allow and increment
  if (entry.count < MAX_PER_WINDOW) {
    entry.count += 1;
    emailSentMap.set(signature, entry);
    return true;
  }
  // Limit reached: circuit opens, block email
  return false;
}

async function sendErrorEmail(err, req) {
  try {
    const tpl = loadTemplate();
    const time = new Date().toISOString();
    const route = req ? `${req.method} ${req.originalUrl}` : 'N/A';
    const stack = err && err.stack ? err.stack : String(err);

    const signature = `${packageJson.name}-`+ (err.message || '') + '|' + (stack.split('\n')[0] || '');
    // If Redis is configured, use redis-backed limiter
    let allow = shouldSendEmail(signature);
    try {
      const redisAllowed = await redisShouldSend(signature, Number(process.env.ERROR_EMAIL_WINDOW_MS || 600000), Number(process.env.ERROR_EMAIL_MAX || 3));
      if (redisAllowed === false) allow = false;
      else if (redisAllowed === true) allow = true; // redis preferred
    } catch (e) {
      logger.warn('Redis rate limiter check failed, using local limiter: %o', e);
    }
    if (!allow) {
      logger.warn('Error email rate-limited for signature: %s', signature);
      return;
    }

    const data = {
      TIME: time,
      SERVICE: process.env.SERVICE_NAME || 'express-app',
      ROUTE: route,
      MESSAGE: err.message || String(err),
      STACK: stack,
      REQ_METHOD: req ? req.method : '',
      REQ_QUERY: req && req.query ? JSON.stringify(req.query, null, 2) : '',
      REQ_BODY: req && req.body ? JSON.stringify(req.body, null, 2) : '',
      REQ_HEADERS: req && req.headers ? JSON.stringify(req.headers, null, 2) : '',
      ENV: JSON.stringify({ NODE_ENV: process.env.NODE_ENV || 'dev' }, null, 2)
    };

    const html = renderTemplate(tpl, data);
    /**
     * EMAIL SENDING WITH IMPLICIT TIMEOUT:
     * nodemailer.sendMail() has a default timeout of ~30 seconds.
     * If SMTP server becomes unresponsive, the promise will reject after timeout.
     * This prevents the app from hanging indefinitely on email failures.
     */
    const info = await transporter.sendMail({
      from: process.env.ERROR_FROM || 'errors@example.com',
      to: process.env.ERROR_TO || 'devteam@example.com',
      subject: `[ERROR] ${process.env.SERVICE_NAME || 'express-app'} ${err.message || ''}`,
      html
    });
    logger.info('Error email sent: %s', info.messageId || info.response || JSON.stringify(info));
  } catch (emailErr) {
    logger.error('Failed to send error email: %o', emailErr);
  }
}

module.exports = { logger, sendErrorEmail };
