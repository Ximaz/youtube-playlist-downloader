import { Readable } from "node:stream";
import type {
  StorageService,
  StorageServicePath,
} from "@/services/StorageService.js";
import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import type { PassThrough } from "stream";

export default class StorageServiceFS implements StorageService {
  private async ensurePathExists(path: string) {
    try {
      await stat(path);
    } catch {
      await mkdir(path, { recursive: true, mode: 0o777 });
    }
  }

  async pushMultipart(
    path: StorageServicePath,
    stream: PassThrough,
  ): Promise<string> {
    return await this.push(path, stream);
  }

  async push(
    { parent, filename }: StorageServicePath,
    fileStream: Readable,
  ): Promise<string> {
    await this.ensurePathExists(parent);

    return await new Promise((resolve, reject) => {
      const filePath = path.join(parent, filename);
      try {
        const writeStream = createWriteStream(filePath);

        fileStream
          .pipe(writeStream)
          .on("finish", () => {
            writeStream.close();
            resolve(filePath);
          })
          .once("error", (err) => {
            writeStream.close();
            reject(err);
          });
      } catch (e) {
        if (e instanceof Error) reject(e);
        throw e;
      }
    });
  }

  async pull({ parent, filename }: StorageServicePath): Promise<{
    stream: Readable;
    path: StorageServicePath;
    metadata?: Record<string, string>;
  }> {
    return await new Promise((resolve, reject) => {
      const filePath = path.join(parent, filename);

      try {
        resolve({
          stream: createReadStream(filePath, { autoClose: true }),
          path: { parent, filename },
          metadata: {},
        });
      } catch {
        reject(new Error(`Unable to read the document. (loc: ${filePath})`));
      }
    });
  }

  async head(
    path: StorageServicePath,
  ): Promise<Record<string, string> | undefined> {
    return (await this.exists(path)) ? {} : undefined;
  }

  async exists({ parent, filename }: StorageServicePath): Promise<boolean> {
    try {
      await stat(path.join(parent, filename));
      return true;
    } catch {
      return false;
    }
  }
}
