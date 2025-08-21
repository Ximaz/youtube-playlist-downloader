import { Readable } from "node:stream";

export interface StorageServicePath {
  parent: string;
  filename: string;
}

export abstract class StorageService {
  abstract pushMultipart(
    path: StorageServicePath, // into
    stream: Readable, // the chunks
    contentType: string, // of type
    metadata?: Record<string, string>,
  ): Promise<string>;

  abstract push(
    path: StorageServicePath, // into
    stream: Readable, // the file
    contentType: string, // of type
    metadata?: Record<string, string>,
  ): Promise<string>;

  abstract head(
    path: StorageServicePath,
  ): Promise<Record<string, string> | undefined>;

  abstract pull(path: StorageServicePath): Promise<{
    stream: Readable;
    path: StorageServicePath;
    metadata?: Record<string, string>;
  }>;

  abstract exists(path: StorageServicePath): Promise<boolean>;
}
