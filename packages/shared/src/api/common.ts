import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime();

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function listEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    next_cursor: z.string().nullable(),
  });
}

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
