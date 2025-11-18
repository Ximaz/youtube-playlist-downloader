import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ReadableStream as NodeReadableStream } from "node:stream/web";

export function getBestThumbnailUrl(
  thumbnails: { url: string; width: number; height: number }[],
) {
  return (
    thumbnails
      .sort((t1, t2) => t1.width * t1.height - t2.width * t2.height)
      .at(-1)?.url ?? "#"
  );
}

export async function downloadThumbnail(
  thumbnailUrl: string,
  thumbnailPath: string,
) {
  const res = await fetch(thumbnailUrl);
  if (!res.ok || res.body == null) {
    throw new Error(`Unable to download the thumbnail. (${thumbnailUrl})`);
  }

  const output = createWriteStream(thumbnailPath);

  const nodeWebStream = res.body as unknown as NodeReadableStream<Uint8Array>;

  const nodeReadable = Readable.fromWeb(nodeWebStream);

  await pipeline(nodeReadable, output);

  return thumbnailPath;
}
