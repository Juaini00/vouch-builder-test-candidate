import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import type { Response } from 'express';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { HandoverRequest } from './dto/input.dto';
import { Handover } from '../common/types';
import { renderHandoverHtml } from './handover.view';

jest.mock('./handover.view', () => ({
  renderHandoverHtml: jest.fn().mockReturnValue('<html>stub</html>'),
}));
jest.mock('node:fs', () => ({
  promises: { readFile: jest.fn() },
}));

const mockedReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
const mockedRenderHtml = renderHandoverHtml as jest.MockedFunction<
  typeof renderHandoverHtml
>;

const HOTEL = {
  id: 'lumen-sg',
  name: 'Lumen SG',
  rooms: 40,
  timezone: 'Asia/Singapore',
};

const VALID_BODY: HandoverRequest = {
  hotel: HOTEL,
  events: [],
  nightLog: '',
  targetMorning: '2026-05-30',
  format: 'json',
};

const STUB_HANDOVER = {
  handoverId: 'ho_2026-05-30_lumen-sg_abcd',
  hotel: { id: HOTEL.id, name: HOTEL.name },
  targetMorning: '2026-05-30',
  shiftWindow: { startsAt: 's', endsAt: 'e' },
  generatedAt: '2026-05-30T07:00:00Z',
  sections: { onFire: [], pending: [], fyi: [], flags: [] },
  meta: {
    eventsIngested: 0,
    extractedFromProse: 0,
    threadsBuilt: 0,
    llmCalls: 0,
    warnings: [],
  },
} as unknown as Handover;

function makeRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('HandoverController', () => {
  let service: jest.Mocked<HandoverService>;
  let controller: HandoverController;

  beforeEach(() => {
    jest.clearAllMocks();
    service = {
      generate: jest.fn().mockResolvedValue(STUB_HANDOVER),
    } as unknown as jest.Mocked<HandoverService>;
    controller = new HandoverController(service);
  });

  describe('POST /handover', () => {
    it('returns the generated handover as JSON for a valid body', async () => {
      const res = makeRes();

      const result = await controller.create(VALID_BODY, res);

      expect(service.generate).toHaveBeenCalledTimes(1);
      expect(service.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          hotel: HOTEL,
          targetMorning: '2026-05-30',
          format: 'json',
        }),
      );
      expect(result).toBe(STUB_HANDOVER);
      expect(res.type).not.toHaveBeenCalled();
      expect(mockedRenderHtml).not.toHaveBeenCalled();
    });

    it('renders HTML and sets the content type when format=html', async () => {
      const res = makeRes();

      const result = await controller.create(
        { ...VALID_BODY, format: 'html' },
        res,
      );

      expect(mockedRenderHtml).toHaveBeenCalledWith(STUB_HANDOVER);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.type).toHaveBeenCalledWith('text/html');
      expect(result).toBe('<html>stub</html>');
    });

    it('throws BadRequestException for a malformed body', async () => {
      const res = makeRes();

      await expect(
        controller.create({ not: 'valid' }, res),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(service.generate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when targetMorning has the wrong shape', async () => {
      const res = makeRes();
      const bad = { ...VALID_BODY, targetMorning: '30-05-2026' };

      const err = await controller
        .create(bad, res)
        .catch((e: unknown) => e as BadRequestException);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as { code: string }).code).toBe(
        'INVALID_INPUT',
      );
    });
  });

  describe('GET /handover/sample', () => {
    const sampleEvents = {
      hotel: HOTEL,
      events: [
        {
          id: 'e1',
          timestamp: '2026-05-30T01:00:00+08:00',
          type: 'note',
          room: '101',
          guest: null,
          description: 'guest reported leak',
          status: 'unresolved',
        },
      ],
    };

    beforeEach(() => {
      mockedReadFile.mockImplementation(((p: string) => {
        if (p.endsWith('events.json'))
          return Promise.resolve(JSON.stringify(sampleEvents));
        if (p.endsWith('night-logs.md'))
          return Promise.resolve('relief notes here');
        return Promise.reject(new Error(`unexpected read: ${p}`));
      }) as unknown as typeof fs.readFile);
    });

    it('loads sample data and returns JSON by default', async () => {
      const res = makeRes();

      const result = await controller.sample(undefined, undefined, res);

      expect(service.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          hotel: HOTEL,
          events: sampleEvents.events,
          nightLog: 'relief notes here',
          targetMorning: '2026-05-30',
          format: 'json',
        }),
      );
      expect(result).toBe(STUB_HANDOVER);
      expect(mockedRenderHtml).not.toHaveBeenCalled();
    });

    it('honors the targetMorning query param', async () => {
      await controller.sample('2026-06-01', undefined, makeRes());

      expect(service.generate).toHaveBeenCalledWith(
        expect.objectContaining({ targetMorning: '2026-06-01' }),
      );
    });

    it('renders HTML when format=html is requested', async () => {
      const res = makeRes();

      const result = await controller.sample(undefined, 'html', res);

      expect(mockedRenderHtml).toHaveBeenCalledWith(STUB_HANDOVER);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.type).toHaveBeenCalledWith('text/html');
      expect(result).toBe('<html>stub</html>');
    });

    it('treats a missing night-log file as an empty string', async () => {
      mockedReadFile.mockImplementation(((p: string) => {
        if (p.endsWith('events.json'))
          return Promise.resolve(JSON.stringify(sampleEvents));
        return Promise.reject(new Error('ENOENT'));
      }) as unknown as typeof fs.readFile);

      await controller.sample(undefined, undefined, makeRes());

      expect(service.generate).toHaveBeenCalledWith(
        expect.objectContaining({ nightLog: '' }),
      );
    });
  });
});
