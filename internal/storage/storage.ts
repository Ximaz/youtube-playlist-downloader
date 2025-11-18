import { Readable } from "node:stream";

export declare interface StoragePath {
  parent: string;
  filename: string;
}

export declare interface Storage {
  pushMultipart(
    path: StoragePath, // into
    stream: Readable, // the chunks
    contentType: string, // of type
    metadata?: Record<string, string>,
  ): Promise<string>;

  push(
    path: StoragePath, // into
    stream: Readable, // the file
    contentType: string, // of type
    metadata?: Record<string, string>,
  ): Promise<string>;

  head(path: StoragePath): Promise<Record<string, string> | undefined>;

  pull(path: StoragePath): Promise<{
    stream: Readable;
    path: StoragePath;
    metadata?: Record<string, string>;
  }>;

  exists(path: StoragePath): Promise<boolean>;
}
