import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type PresignPutInput = {
  key: string;
  contentType: string;
  expiresInSeconds: number;
  requiredHeaders?: Record<string, string>;
};

export type PresignGetInput = {
  key: string;
  expiresInSeconds: number;
  responseContentDisposition?: string;
};

export type StorageHead = {
  byteSize: number | null;
  contentType: string | null;
};

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type AppStorage = {
  presignPutUrl(input: PresignPutInput): Promise<{
    url: string;
    requiredHeaders: Record<string, string>;
  }>;
  presignGetUrl(input: PresignGetInput): Promise<string>;
  headObject(key: string): Promise<StorageHead | null>;
  getObjectBytes(key: string): Promise<Uint8Array>;
  putObject(input: PutObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
};

export type S3StorageConfig = {
  bucket: string;
  region: string;
  clientConfig?: S3ClientConfig;
};

function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body)) {
    throw new Error('S3 object body is not readable as bytes');
  }
  return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
}

export function createS3Storage(config: S3StorageConfig): AppStorage {
  const client = new S3Client({ region: config.region, ...(config.clientConfig ?? {}) });

  return {
    async presignPutUrl(input) {
      const requiredHeaders = {
        'content-type': input.contentType,
        'x-amz-server-side-encryption': 'AES256',
        ...(input.requiredHeaders ?? {}),
      };
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ServerSideEncryption: 'AES256',
      });
      return {
        url: await getSignedUrl(client, command, { expiresIn: input.expiresInSeconds }),
        requiredHeaders,
      };
    },

    async presignGetUrl(input) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          ...(input.responseContentDisposition
            ? { ResponseContentDisposition: input.responseContentDisposition }
            : {}),
        }),
        { expiresIn: input.expiresInSeconds },
      );
    },

    async headObject(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          byteSize: result.ContentLength ?? null,
          contentType: result.ContentType ?? null,
        };
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'NotFound' || name === 'NoSuchKey' || name === 'NotFoundError') return null;
        throw error;
      }
    },

    async getObjectBytes(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return bodyToBytes(result.Body);
    },

    async putObject(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}

export async function presignPutUrl(storage: AppStorage, input: PresignPutInput) {
  return storage.presignPutUrl(input);
}

export async function presignGetUrl(storage: AppStorage, input: PresignGetInput) {
  return storage.presignGetUrl(input);
}
