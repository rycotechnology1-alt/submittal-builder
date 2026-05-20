import { createS3Storage, type AppStorage } from '@submittal/shared/storage';

import { env } from '@/env';

let storage: AppStorage | null = null;

export function getStorage(): AppStorage {
  if (storage) return storage;
  if (!env.s3Bucket) {
    throw new Error('Missing S3_BUCKET or S3_BUCKET_DEV for object storage');
  }

  storage = createS3Storage({
    bucket: env.s3Bucket,
    region: env.AWS_REGION,
  });
  return storage;
}
