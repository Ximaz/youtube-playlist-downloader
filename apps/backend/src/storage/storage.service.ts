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
    } catch {
      return null;
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
    } catch {
      return null;
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
