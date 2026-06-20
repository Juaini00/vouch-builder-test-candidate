import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; version: string } {
    return { status: 'ok', version: '0.1.0' };
  }
}
