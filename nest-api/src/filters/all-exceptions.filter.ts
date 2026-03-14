import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { LoggerService } from '../logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly loggerService: LoggerService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const message = exception instanceof HttpException ? exception.getResponse() : (exception as any).message || 'Internal Server Error';

    // Log with full context
    this.loggerService.error('Unhandled exception: %o', exception);
    /**
     * ASYNCHRONOUS ERROR NOTIFICATION:
     * Sends email notification fire-and-forget style.
     * Rate limiting (circuit breaker) applied within sendErrorEmail().
     * .catch(() => {}) silently ignores email send failures to prevent
     * them from affecting the HTTP response flow.
     */
    this.loggerService.sendErrorEmail(exception, { getRequest: () => request }).catch(() => {});

    response.status(status).json({ statusCode: status, message });
  }
}
