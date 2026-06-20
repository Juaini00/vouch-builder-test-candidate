import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  HandoverRequest,
  handoverRequestSchema,
} from './dto/input.dto';
import { HandoverService } from './handover.service';
import { renderHandoverHtml } from './handover.view';

const DEFAULT_TARGET_MORNING = '2026-05-30';

@Controller('handover')
export class HandoverController {
  constructor(private readonly service: HandoverService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const parsed = handoverRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_INPUT',
        issues: parsed.error.issues,
      });
    }
    const req = parsed.data;
    const handover = await this.service.generate(req);
    if (req.format === 'html') {
      res.status(HttpStatus.OK).type('text/html');
      return renderHandoverHtml(handover);
    }
    return handover;
  }

  @Get('sample')
  async sample(
    @Query('targetMorning') targetMorning: string | undefined,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const dataRoot = process.env.DATA_ROOT ?? './data';
    const [eventsRaw, nightLog] = await Promise.all([
      fs.readFile(path.join(dataRoot, 'events.json'), 'utf8'),
      fs
        .readFile(path.join(dataRoot, 'night-logs.md'), 'utf8')
        .catch(() => ''),
    ]);
    const parsedJson = JSON.parse(eventsRaw) as {
      hotel: HandoverRequest['hotel'];
      events: HandoverRequest['events'];
    };
    const req: HandoverRequest = {
      hotel: parsedJson.hotel,
      events: parsedJson.events,
      nightLog,
      targetMorning: targetMorning ?? DEFAULT_TARGET_MORNING,
      format: format === 'html' ? 'html' : 'json',
    };
    const handover = await this.service.generate(req);
    if (req.format === 'html') {
      res.status(HttpStatus.OK).type('text/html');
      return renderHandoverHtml(handover);
    }
    return handover;
  }
}
