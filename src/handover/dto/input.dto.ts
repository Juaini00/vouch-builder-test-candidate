import { z } from 'zod';

export const rawEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  room: z.string().nullable(),
  guest: z.string().nullable(),
  description: z.string(),
  status: z.enum(['resolved', 'unresolved', 'pending']),
});

export const hotelSchema = z.object({
  id: z.string(),
  name: z.string(),
  rooms: z.number().int().positive().optional(),
  timezone: z.string(),
});

export const handoverRequestSchema = z.object({
  hotel: hotelSchema,
  events: z.array(rawEventSchema).default([]),
  nightLog: z.string().optional(),
  targetMorning: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'targetMorning must be YYYY-MM-DD',
  }),
  format: z.enum(['json', 'html']).optional().default('json'),
});

export type RawEvent = z.infer<typeof rawEventSchema>;
export type HandoverRequest = z.infer<typeof handoverRequestSchema>;
