# Nest API

Minimal Nest.js scaffold with advanced features.

## Features

- **NestJS Framework**: Modern Node.js framework for building scalable applications
- **Winston Logger**: Comprehensive logging with timestamp and error stack tracking
- **Error Email Notifications**: Automatic error email alerts with rate limiting
- **Circuit Breaker Pattern**: Dual-layer rate limiting (Redis + Local fallback)
- **Redis Integration**: Distributed rate limiting for multi-instance deployments
- **Graceful Degradation**: Works even when Redis is unavailable
- **Global Exception Filter**: Centralized error handling across the application
- **TypeScript Support**: Full TypeScript compilation and type safety
- **Docker Support**: Multi-stage Docker build for optimized containers

## Installation

```bash
cd tst/nest-api
npm install
```

## Development

```bash
npm run start:dev
```

Fast reload with `ts-node-dev`.

## Build

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

## Production

```bash
npm start
```

Runs the compiled application on port 3001 (or `PORT` environment variable).

## API Endpoints

- `GET /` → "Hello from Nest"
- `GET /ping` → `{ "pong": true }`
- `GET /error` → Throws a demo error (for testing error handling)

## Configuration

Environment variables (see `.env.example`):

- `PORT` - Server port (default: 3001)
- `LOG_LEVEL` - Winston log level (default: info)
- `REDIS_URL` - Redis connection URL (optional)
- `SMTP_HOST` - SMTP server hostname (default: localhost)
- `SMTP_PORT` - SMTP server port (default: 1025)
- `SMTP_USER` - SMTP username (optional)
- `SMTP_PASS` - SMTP password (optional)
- `ERROR_TO` - Email recipient for errors (default: devteam@example.com)
- `ERROR_FROM` - Email sender for errors (default: errors@example.com)
- `ERROR_EMAIL_WINDOW_MS` - Rate limit window (default: 600000ms = 10min)
- `ERROR_EMAIL_MAX` - Max emails per window (default: 3)
- `SERVICE_NAME` - Service name for logs (default: nest-api)
- `ERROR_EMAIL_TEMPLATE` - Path to error email HTML template

## Docker

Build and run with Docker:

```bash
docker build -t nest-api .
docker run -p 3001:3001 \
  -e REDIS_URL=redis://redis:6379 \
  -e SMTP_HOST=mailpit \
  -e SMTP_PORT=1025 \
  nest-api
```

## Architecture

### Error Handling Flow

1. Request triggers an error
2. Global `AllExceptionsFilter` catches the exception
3. Error is logged via `LoggerService`
4. Fire-and-forget email notification is sent (async)
5. HTTP response is returned immediately (500 status)

### Rate Limiting (Circuit Breaker)

**Dual-layer approach:**

1. **Primary**: Redis-backed distributed rate limiter (for multi-instance setups)
2. **Fallback**: Local in-memory rate limiter (when Redis unavailable)

The circuit breaker automatically:
- Opens (blocks emails) when max rate reached
- Closes (allows emails) when window expires
- Degrades gracefully if Redis is down

### Logger Service

- **Winston Logger**: Structured logging with timestamps
- **Email Transport**: Nodemailer integration for notifications
- **Template Rendering**: HTML email templates with variable substitution
- **Error Deduplication**: Uses error signature for intelligent rate limiting
