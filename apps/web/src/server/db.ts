// Process-wide singleton Drizzle client for the web app.
import { getDb } from '@submittal/db/client';
import { env } from '@/env';

export const db = getDb({ url: env.databaseUrl, max: 1 });
export { schema } from '@submittal/db/client';
