import { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { MetricsService } from '../observability/metrics.service';

export interface ObjectHead {
  contentLength?: number;
  contentType?: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {
    const storage = config.storage;
    this.bucket = storage.bucket;
    this.client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      credentials: { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey },
      // Bound every S3 call: a hung socket must not stall a worker until the OS TCP timeout.
      // (The SDK builds the default Node handler from this options object — no extra import.)
      requestHandler: {
        connectionTimeout: storage.connectionTimeoutMs,
        requestTimeout: storage.requestTimeoutMs,
      },
      maxAttempts: storage.maxAttempts,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.#timed('head-bucket', () =>
        this.client.send(new HeadBucketCommand({ Bucket: this.bucket })),
      );
    } catch {
      this.logger.log(`Bucket "${this.bucket}" not found — creating it`);
      await this.#timed('create-bucket', () =>
        this.client.send(new CreateBucketCommand({ Bucket: this.bucket })),
      );
    }
  }

  /** Memory-bounded multipart upload from an arbitrary Readable. */
  async uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
    await this.#timed('put-stream', async () => {
      const upload = new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
        partSize: 8 * 1024 * 1024,
        queueSize: 4,
      });
      await upload.done();
    });
  }

  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.#timed('get-stream', () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    return res.Body as Readable;
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.#timed('head', () =>
        this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
      );
      return { contentLength: res.ContentLength, contentType: res.ContentType };
    } catch (err) {
      // A genuine 404 means "not cached" → null is correct. Any other error (S3 unreachable,
      // 5xx, timeout) must propagate so the pre-filter doesn't misread an outage as a cache
      // miss and re-download everything.
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.#timed('put-json', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(value),
          ContentType: 'application/json',
        }),
      ),
    );
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const res = await this.#timed('get-json', () =>
        this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
      );
      const body = await res.Body?.transformToString();
      return body ? (JSON.parse(body) as T) : null;
    } catch (err) {
      // Missing object → null; a real S3 outage propagates (see head()).
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async #timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const end = this.metrics.s3OpDuration.startTimer({ op });
    try {
      return await fn();
    } finally {
      end();
    }
  }
}

/** True only for "object/bucket does not exist" (404 / NoSuchKey / NotFound). Everything else
 *  — network error, timeout, 5xx, throttling — is a real failure that must not be swallowed. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey';
}
