import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot(): string {
    return this.appService.getHello();
  }

  @Get('ping')
  getPing() {
    return { pong: true };
  }

  @Get('error')
  getError() {
    throw new Error('Demo error from Nest /error');
  }
}
