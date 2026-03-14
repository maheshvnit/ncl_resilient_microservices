const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
// support distributed rate limiting via Redis
const { redisShouldSend } = require('./redisLimiter');

//import * as packageJson from '../package.json';
const packageJson = require('../package.json');

const ERROR_EMAIL_WINDOW_MS = parseInt(process.env.ERROR_EMAIL_WINDOW_MS || '600000', 10);
const ERROR_EMAIL_MAX = parseInt(process.env.ERROR_EMAIL_MAX || '3', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'fastify-app';
const SMTP_HOST = process.env.SMTP_HOST || 'mailpit';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '1025', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const ERROR_TO = process.env.ERROR_TO || 'devteam@example.com';
const ERROR_FROM = process.env.ERROR_FROM || 'errors@example.com';
const TEMPLATE_PATH = process.env.ERROR_EMAIL_TEMPLATE || path.join(process.cwd(), 'templates/error_email.html');

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false,
  auth: SMTP_USER || SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  tls: { rejectUnauthorized: false }
});

// Template loader and simple placeholder renderer
let templateCache = null;

function loadTemplate() {
  if (templateCache) return templateCache;
  try {
    templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (e) {
    console.error('Failed to load error email template:', e);
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
 * CIRCUIT BREAKER PATTERN - IN-MEMORY RATE LIMITING:
 * Stores timestamp history for each unique error signature.
 * Prevents email alert flooding by limiting notifications for repeated errors.
 * Configuration:
 * - ERROR_EMAIL_WINDOW_MS: Time window for counting (default: 600000ms = 10 min)
 * - ERROR_EMAIL_MAX: Max emails allowed per signature within window (default: 3)
 */
const sent = new Map();

/**
 * Generate unique signature for error deduplication.
 * Combines error message + request path to identify recurring error patterns.
 */
function signatureFor(err, request) {
  const path = request && request.url ? request.url : '';
  const msg = err && err.message ? err.message : 'error';
  //msg = `${packageJson.name}-` + msg;
  return `${packageJson.name}-${msg}::${path}`;
}

/**
 * LOCAL CIRCUIT BREAKER - RATE LIMITER:
 * Implements sliding window algorithm for rate limiting.
 * Only keeps timestamps within current window, automatically pruning old entries.
 * 
 * Logic:
 * 1. Calculate window start time
 * 2. Filter timestamps to only those within window
 * 3. If count >= max: circuit opens, block email (return false)
 * 4. If count < max: circuit closed, allow email (return true)
 */
function shouldSend(sig) {
  const now = Date.now();
  const windowStart = now - ERROR_EMAIL_WINDOW_MS;
  const arr = sent.get(sig) || [];
  // Filter to only recent timestamps within current window
  const recent = arr.filter((t) => t >= windowStart);
  // Circuit breaker: open circuit if threshold reached
  if (recent.length >= ERROR_EMAIL_MAX) {
    sent.set(sig, recent);
    return false; // Block email - circuit open
  }
  // Circuit still closed: allow email
  recent.push(now);
  sent.set(sig, recent);
  return true;
}

/**
 * SEND ERROR EMAIL WITH CIRCUIT BREAKER:
 * Respects rate limiting before attempting to send.
 * Uses template-based email rendering for consistency across services.
 * Provides graceful degradation if SMTP fails.
 */
async function sendErrorEmail(err, request) {
  const sig = signatureFor(err, request);
  // first consult distributed limiter (circuit breaker)
  try {
    const allowed = await redisShouldSend(sig, ERROR_EMAIL_WINDOW_MS, ERROR_EMAIL_MAX);
    if (!allowed) {
      return; // redis says circuit is open
    }
  } catch (e) {
    // if the Redis check fails, we'll fall back to local limiter below
    console.warn('redisShouldSend failed, falling back to local in-memory limiter:', e && e.message ? e.message : e);
  }
  // Rate limiter acts as circuit breaker - prevent email flood (local fallback)
  if (!shouldSend(sig)) return;

  try {
    const tpl = loadTemplate();
    const time = new Date().toISOString();
    const route = request ? `${request.method} ${request.url}` : 'N/A';
    const stack = err && err.stack ? err.stack : String(err);

    const data = {
      TIME: time,
      SERVICE: SERVICE_NAME,
      ROUTE: route,
      MESSAGE: err.message || String(err),
      STACK: stack,
      REQ_METHOD: request ? request.method : '',
      REQ_QUERY: request && request.query ? JSON.stringify(request.query, null, 2) : '',
      REQ_BODY: request && request.body ? JSON.stringify(request.body, null, 2) : '',
      REQ_HEADERS: request && request.headers ? JSON.stringify(request.headers, null, 2) : '',
      ENV: JSON.stringify({ NODE_ENV: process.env.NODE_ENV || 'dev' }, null, 2)
    };

    const html = renderTemplate(tpl, data);

    const mail = {
      from: ERROR_FROM,
      to: ERROR_TO,
      subject: `[ERROR] ${SERVICE_NAME} ${err.message}`,
      html
    };

    return transport.sendMail(mail);
  } catch (emailErr) {
    console.error('Failed to send error email:', emailErr);
  }
}

module.exports = sendErrorEmail;
