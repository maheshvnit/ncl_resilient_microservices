import { Injectable, OnModuleInit } from '@nestjs/common';
const { createLogger, format, transports } = require('winston');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

@Injectable()
export class LoggerService implements OnModuleInit {
  private logger: any;
  private transporter: any;
  private template: string | null = null;
  private emailSentMap = new Map<string, {count:number, start:number}>();

  onModuleInit() {
    this.logger = createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
      transports: [new transports.Console({ format: format.simple() })]
    });

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 1025,
      secure: false,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined
    });

    // load template
    const tplPath = process.env.ERROR_EMAIL_TEMPLATE || path.join(process.cwd(), 'templates/error_email.html');
    console.log('Using error email template:', tplPath);
    try {
      this.template = fs.readFileSync(tplPath, 'utf8');
    } catch (e) {
      //console.log('Using error email template:', tplPath);
      console.error('Using error email template:', e);
      this.template = '<pre>{{STACK}}</pre>';
    }
  }

  log(...args: any[]) {
    this.logger.info(...args);
  }
  error(...args: any[]) {
    this.logger.error(...args);
  }

  private renderTemplate(tpl: string, data: Record<string, any>) {
    return tpl.replace(/{{(\w+)}}/g, (_, key) => {
      const v = data[key] !== undefined ? data[key] : '';
      return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    });
  }

  /**
   * LOCAL CIRCUIT BREAKER - FALLBACK RATE LIMITING:
   * Secondary rate limiter when Redis is unavailable.
   * Provides in-process protection against email flooding.
   * 
   * Window-based strategy:
   * - Tracks count and window start time
   * - Resets automatically when window expires
   * - Blocks emails when max count reached
   */
  private shouldSendEmail(signature: string) {
    const WINDOW_MS = Number(process.env.ERROR_EMAIL_WINDOW_MS || 600000); // 10 min
    const MAX_PER_WINDOW = Number(process.env.ERROR_EMAIL_MAX || 3);
    const now = Date.now();
    const entry = this.emailSentMap.get(signature) || { count: 0, start: now };
    // Window expired: reset counter (circuit heals)
    if (now - entry.start > WINDOW_MS) {
      this.emailSentMap.set(signature, { count: 1, start: now });
      return true;
    }
    // Within limit: allow email
    if (entry.count < MAX_PER_WINDOW) {
      entry.count += 1;
      this.emailSentMap.set(signature, entry);
      return true;
    }
    // Limit reached: circuit opens
    return false;
  }

  async sendErrorEmail(err: any, context?: any) {
    try {
      const request = context && context.getRequest ? context.getRequest() : undefined;
      const time = new Date().toISOString();
      const route = request ? `${request.method} ${request.url}` : 'N/A';
      const stack = err && err.stack ? err.stack : String(err);
      const signature = (err.message || '') + '|' + (stack.split('\n')[0] || '');
      /**
       * DUAL-LAYER CIRCUIT BREAKER:
       * 1. Primary: Redis-backed distributed limiter (for multi-instance deployments)
       * 2. Fallback: Local in-memory limiter (when Redis unavailable)
       * 
       * This ensures rate limiting works regardless of Redis availability,
       * providing graceful degradation.
       */
      // Start with local limiter
      let allow = this.shouldSendEmail(signature);
      // Try to check distributed Redis limiter too
      try {
        const { redisShouldSend } = require('./redis-rate-limiter');
        const redisAllowed = await redisShouldSend(
          signature,
          Number(process.env.ERROR_EMAIL_WINDOW_MS || 600000),
          Number(process.env.ERROR_EMAIL_MAX || 3)
        );
        // Redis result takes precedence (more authoritative in multi-instance setup)
        if (redisAllowed === false) allow = false;
        else if (redisAllowed === true) allow = true;
      } catch (e) {
        // Redis error: continue with local limiter decision (graceful degradation)
      }
      // CIRCUIT BREAKER CHECK: Block if limit reached
      if (!allow) {
        this.logger.warn('Error email rate-limited for signature: %s', signature);
        return; // Circuit open - no email sent
      }

      const data = {
        TIME: time,
        SERVICE: process.env.SERVICE_NAME || 'nest-api',
        ROUTE: route,
        MESSAGE: err.message || String(err),
        STACK: stack,
        REQ_METHOD: request ? request.method : '',
        REQ_QUERY: request && request.query ? JSON.stringify(request.query, null, 2) : '',
        REQ_BODY: request && request.body ? JSON.stringify(request.body, null, 2) : '',
        REQ_HEADERS: request && request.headers ? JSON.stringify(request.headers, null, 2) : '',
        ENV: JSON.stringify({ NODE_ENV: process.env.NODE_ENV || 'dev' }, null, 2)
      };

      const html = this.template ? this.renderTemplate(this.template, data) : `<pre>${stack}</pre>`;

      //console.log('Using error email template-1:', this.template, html);

      const info = await this.transporter.sendMail({
        from: process.env.ERROR_FROM || 'errors@example.com',
        to: process.env.ERROR_TO || 'devteam@example.com',
        subject: `[ERROR] ${process.env.SERVICE_NAME || 'nest-api'} ${err.message || ''}`,
        html
      });
      this.logger.info('Error email sent: %s', info.messageId || info.response || JSON.stringify(info));
    } catch (emailErr) {
      this.logger.error('Failed to send error email: %o', emailErr);
    }
  }
}
