# Service Resilience Architecture
## Building Resilient Microservices: Why Retry, Timeout, Circuit Breaker &amp; Fallback Matter - Service Resilience Architecture

# Fault-Tolerance and Resiliency Mechanisms
# Service Resilience and Fault-Tolerance Patterns

![Service Resilience Architecture](docs/Service-resilience-flowchart-overview.png)

## 🧭 Overall Architecture
The project demonstrates resilient microservice patterns:

  - Retry (Redis reconnection)
  - Timeout (implicit via transport timeouts)
  - Circuit breaker (email alert rate-limiter)
  - Fallback (in-memory fallback when Redis down)

It includes:

  - express-app
  - fastify-app
  - nest-api
  - nest-app


Service resilience is a core architectural capability in distributed systems and microservices. The goal is to **keep the system functional even when some components fail, slow down, or become temporarily unavailable**. In Node.js systems (Express, NestJS, Fastify), resilience is implemented through several **fault-tolerance patterns**.

1.) Retry with backoff

2.) Timeout

3.) Circuit Breaker

4.) Resilience/Fallback


Modern distributed systems will fail at some point — network latency, downstream service outages, database overload, or temporary API failures. The real engineering challenge is not preventing failure entirely, but designing systems that handle failure gracefully.



This is where Service Resilience Architecture becomes critical.


In a typical microservices flow:

Client → API Gateway → Service A → Service B → Service C

If Service C fails, it can trigger a cascading failure across the entire system unless resilience mechanisms are in place.


Here are four essential fault-tolerance patterns every backend engineer should understand and implement:

1️⃣ **Retry with Backoff**
Automatically retry transient failures with exponential delay to avoid retry storms.

2️⃣ **Timeout**
Define strict time limits for external service calls so resources are not blocked indefinitely.

3️⃣ **Circuit Breaker**
Prevent repeated calls to failing services by temporarily blocking requests once error thresholds are reached.

4️⃣ **Fallback**
Return cached data or degraded responses instead of failing completely.


When combined properly, the flow becomes:

Client Request

  → Timeout Protection
  
  → Retry with Backoff
  
  → Circuit Breaker Guard
  
  → Fallback Response
  
This approach helps prevent:

  • Cascading failures
  
  • System overload
  
  • Poor user experience during outages
  

These resilience patterns can be implemented in Node.js ecosystems such as Express.js, NestJS, and Fastify using libraries like circuit breakers, retry policies, and timeout controls.

In distributed systems, resilience is not optional — it is part of the architecture.

![Service resilience architecture](docs/Service-resilience-architecture.png)

## Behavior of Each App

| App         | Redis  | Retry   | Circuit Breaker | Fallback    |
|-------------|--------|---------|-----------------|-------------|
| express-app	| Yes	   | Yes	   | Redis + memory	 | Yes         |
| nest-api	  | Yes	   | Yes	   | Redis + memory	 | Yes         |
| nest-app	  | Yes	   | Yes	   | Redis + memory	 | Yes         |
| fastify-app	| No	   | No	     | Memory only	   | Not needed  |


##  🔍 Common themes
All of the apps are small demo servers whose only external dependencies are:

  - a Redis instance (used for a distributed rate limiter)

  - an SMTP server (used by nodemailer to send the alert emails).

Each app contains:

  - Retry – only on the Redis connection. An exponential‑backoff retryStrategy/reconnectOnError is passed to ioredis in every implementation. (There is no “retry the sendMail call” logic; nodemailer itself will eventually time‑out and reject.)

  - Timeout – implicit rather than explicit. The email‑transport isn’t wrapped in a custom timeout, but the default nodemailer timeout (~30 s) protects the process from hanging. Redis operations also time‑out internally if the socket is lost.

  - Circuit breaker – yes, in all apps. The error‑email functions maintain a counter per signature and, once the configured threshold (ERROR_EMAIL_MAX/ERROR_EMAIL_WINDOW_MS) is exceeded, “open the circuit” and stop sending further alerts. This behaviour is implemented both in‑memory and, when Redis is available, via a Redis‑backed counter – the latter serving as a distributed breaker for multi‑instance deployments.

  - Resilience/fallback – also present in all four. If Redis is unreachable the code logs a warning and falls back to the local in‑memory limiter (or, in the fastify app, to a no‑op that simply allows the email). Email‑send errors are caught and logged without impacting the HTTP response. Redis connection failures are logged and automatically retried.

## ✔️ Conclusion
All four apps do implement the patterns listed for their error‑notification subsystem:

  - Redis clients retry on failure.

  - Calls to external services time‑out (implicitly).

  - A circuit‑breaker/rate‑limiter prevents alert storms.

  - There is graceful degradation when Redis or SMTP are unavailable.

No code crashes the process; failures are logged and the HTTP handlers always return a response.

The goal was to check that each app correctly implements retry, timeout, circuit breaker and fallback, then yes – they are implemented consistently across the board.


![Fault tolerance in microservice architecture](docs/Fault-tolerance-in-microservice-architecture.png)

---

## 🔧 Implemented Apps + Endpoints
- 1) express-app
  - GET / → “Hello from Express”
  - GET /api/... from routes (main app route entry)
  - Global error handler sends error email
  - Supports:
      - Redis with retry (ioredis retryStrategy + reconnectOnError)
      - Redis circuit breaker via redisLimiter.redisShouldSend(...)
      - In-memory fallback circuit breaker in logger.js
      - Email sending via nodemailer with template fallback

- 2) fastify-app
  - GET / → health hello
  - GET /error → intentional error
  - Global fastify error handler sends email using emailSender
  - In emailSender:
     - in-memory rate limiter circuit breaker
     - Redis-backed limiter fallback (via redisLimiter.redisShouldSend)
     - Template-based error email
  - No Redis requirement for app run (allows no Redis)

- 3) nest-api
  - GET / → hello
  - GET /ping → { pong: true }
  - GET /error → intentional exception
  - Uses LoggerService for log + mail behavior
  - Circuit breaker in LoggerService:
     - local in-memory map
     - tries Redis via redis-rate-limiter.ts and uses that as authoritative
  - Retry for Redis via redis-rate-limiter retryStrategy

- 4) nest-app
  - Same API and resilience pattern as nest-api:
     - root, ping, error endpoints
     - logger service with email send + rate limiter
     - redis retry and distributed rate limiting

---

## 🧠 What is Actually Implemented (All APIs+Services)

Core resilience implementation patterns:
  - Redis retry: ioredis retry strategy exponential backoff and reconnectOnError in each Redis utility.
  - Timeout: email/Redis operations use default timeouts; handlers avoid crashing by catching errors.
  - Circuit breaker:
    - Redis counter + TTL check for shared distributed limiting
    - Local memory map fallback
    - ERROR_EMAIL_MAX and ERROR_EMAIL_WINDOW_MS config controls threshold
  - Fallback:
    - When Redis is unavailable, local in-memory limiter and allow-on-redis-failure behavior.
    - Error emails are fire-and-forget; request response still returns standard HTTP error.
  - Graceful failure:
    - All apps catch email send failures and do not block request flow.
    - They log and continue.

App behavior summary (as README table):

  - express-app: Redis yes, retry yes, circuit Redis+memory yes, fallback yes
  - nest-api: same as express
  - nest-app: same as express
  - fastify-app: no Redis required, no retry fallback needed, memory circuit only

---

## 📌 Key Files by App
- app.js
- errorHandler.js
- logger.js
- redisLimiter.js
- server.js
- emailSender.js
- redisLimiter.js
- app.controller.ts
- logger.service.ts
- redis-rate-limiter.ts
- app.controller.ts
- logger.service.ts
- redis-rate-limiter.ts

---

✅ Quick Implementation Verification

If you want to quickly verify the runtime behavior:

- Start Redis + Mailpit (or local SMTP)
- Run docker-compose up from repo root
- Hit:
  - http://localhost:3001/error (depending service ports)
  - Confirm email rate limit works after repeated errors
- Check logs for Redis reconnect events + fallback warnings.

---


I’ll proceed by giving exact run commands and verification steps you can execute locally.

## ✅ Implementation Verified in Code

Great news: the code already includes the test simulation and verification path you asked for.

simulate-errors.js intentionally fires repeated /error requests across all four services, and each service logs errors + attempts error emails with rate limiting.

Key pieces already implemented:
 - simulate-errors.js rotates requests to:
     - Express /api/error
     - Nest-app /error
     - Nest-api /error
     - Fastify /error
 - Each app has global error handling + nodemailer email send with circuit-breaker rate limiting.
 - Mailpit is configured in docker-compose.yml (SMTP host/port + UI on 8025).
 - Redis-backed distributed limiter in express/nest; memory fallback in all.

---

## ▶️ Run Simulation and Verify on Your Machine

From ncl_resilient_microservices:

- Start stack:
```
docker compose up -d
````

- Wait until all services are healthy:
```
docker compose ps
````
- Run simulation:
```
cd ncl_resilient_microservices
node simulate-errors.js 20 5
````

- Confirm each error endpoint returns 500:
  - http://localhost:3030/api/error
  - http://localhost:3031/error
  - http://localhost:3032/error
  - http://localhost:3033/error

- Open Mailpit UI:
  - http://localhost:8025
  - Check received emails for service error alerts.

- Check logs for rate-limit behavior:
```
docker compose logs express-app --tail 200
docker compose logs nest-app --tail 200
docker compose logs nest-api --tail 200
docker compose logs fastify-app --tail 200
````

Look for warnings like Error email rate-limited and success lines Error email sent.

---

## 🔍 What to validate in logs/UI
- Errors are being logged from the request handlers.
- Email send attempts appear from each service.
- After ERROR_EMAIL_MAX attempts, messages stop and you see "rate-limited" log.
- Mailpit UI shows outgoing emails for the first few errors.

---

## 📌 Use Cases

- Microservices Resilience Architecture
- Debugging production incidents
- Performance tuning
- SRE / Platform engineering setups
- Learning LGTM stack

---

## 🤝 Contributing

PRs and improvements are welcome!
Feel free to open issues or suggest enhancements.

---

## ⭐ If this helped you

Give the repo a ⭐ and share it with your team!

---

## 📜 License

MIT License
