import { Readable } from "node:stream";
import { ReadableStream as NodeWebStream } from "node:stream/web";
import path from "node:path/posix"; // Only use POSIX style with Minio
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  BucketAlreadyOwnedByYou,
  NotFound,
  NoSuchBucket,
} from "@aws-sdk/client-s3";
import type { Storage, StoragePath } from "@internal/storage/storage";

interface S3StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export default class StorageS3 implements Storage {
  private readonly client: S3Client;

  constructor({
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle = true,
  }: S3StorageConfig) {
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private async ensureBucketExists(bucket: string) {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (e) {
      if (e instanceof BucketAlreadyOwnedByYou) return void 0;

      if (e instanceof NotFound || e instanceof NoSuchBucket)
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));

      throw e;
    }
  }

  private async flushMultiparts(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { ETag?: string; PartNumber: number }[],
    partState: { partNumber: number; buffer: Buffer[]; bufferedBytes: number },
  ) {
    if (partState.bufferedBytes === 0) return;

    const body = Buffer.concat(partState.buffer, partState.bufferedBytes);
    partState.buffer = [];
    partState.bufferedBytes = 0;

    const { ETag } = await this.client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partState.partNumber,
        Body: body,
        ContentLength: body.length,
      }),
    );

    parts.push({ ETag, PartNumber: partState.partNumber });
    ++partState.partNumber;
  }

  async pushMultipart(
    { parent, filename }: StoragePath,
    stream: Readable,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<string> {
    const [bucket, ...keyFragments] = parent.split(/\//g);

    const key = path.join(...keyFragments, filename);

    await this.ensureBucketExists(bucket!);

    const createRes = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        Metadata: metadata,
      }),
    );
    const uploadId = createRes.UploadId as string;

    const minPartSize = 5 * 1024 * 1024; // 5MB
    const parts: { ETag?: string; PartNumber: number }[] = [];
    const partState = {
      partNumber: 1,
      buffer: [] as Buffer[],
      bufferedBytes: 0,
    };

    try {
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        partState.buffer.push(buf);
        partState.bufferedBytes += buf.length;

        if (partState.bufferedBytes >= minPartSize) {
          await this.flushMultiparts(bucket!, key, uploadId, parts, partState);
        }
      }

      await this.flushMultiparts(bucket!, key, uploadId, parts, partState);

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (err) {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
      throw err;
    }

    return `s3://${bucket}/${key}`;
  }

  async push(
    { parent, filename }: StoragePath,
    stream: Readable,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<string> {
    const [bucket, ...keyFragments] = parent.split(/\//g);

    const key = path.join(...keyFragments, filename);

    await this.ensureBucketExists(bucket!);

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        Metadata: metadata,
      }),
    );

    return `s3://${bucket}/${key}`;
  }

  async head({ parent, filename }: StoragePath) {
    const [bucket, ...keyFragments] = parent.split(/\//g);

    const key = path.join(...keyFragments, filename);

    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return result.Metadata;
    } catch {
      return undefined;
    }
  }

  async pull({ parent, filename }: StoragePath): Promise<{
    stream: Readable;
    path: StoragePath;
    metadata?: Record<string, string>;
  }> {
    const [bucket, ...keyFragments] = parent.split(/\//g);

    const key = path.join(...keyFragments, filename);

    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (undefined === result.Body)
      throw new Error(`Unable to find the document. (loc: ${bucket}/${key})`);

    return {
      stream: result.Body as Readable,
      path: { parent, filename },
      metadata: result.Metadata,
    };
  }

  async exists({ parent, filename }: StoragePath): Promise<boolean> {
    const [bucket, ...keyFragments] = parent.split(/\//g);

    const key = path.join(...keyFragments, filename);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
