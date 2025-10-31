import { redisClient } from "@/infrastructure/config/env.js";

/**
 * This RegExp is executed against the HTML content of a Youtube video page in
 * order to detect and extract the related metadata. It checks for an optional
 * 'head' element query because it is present on the 'Unlisted' video pages, but
 * not on regular pages, leading to ignored result.
 */
const VIDEO_METADATA_REGEX =
  /var ytInitialPlayerResponse = (\{.+\});(?:var head = document\.getElementsByTagName\('head'\)\[0\];)?\s?var meta = document\.createElement\('meta'\);/;

function sanitizeMetadataValue(value: string) {
  return value
    .replace(/[\n\r]+/g, " ") // remove line breaks
    .replace(/[^\x20-\x7E]+/g, "") // remove non-ASCII symbols
    .trim();
}

function getBestThumbnailUrl(
  thumbnails: { url: string; width: number; height: number }[],
) {
  return thumbnails
    .sort((t1, t2) => t1.width * t1.height - t2.width * t2.height)
    .at(-1)?.url;
}

function parseDate(date: Date) {
  return date.toISOString().split("T")[0];
}

/**
 * Get the Youtube video metadata from the HTML page content. The result is
 * extracted using a RegExp. It may be outdated some day, so this is a point
 * of attention in case something breaks as it relies on unofficial API.
 * @param videoId The Youtube video ID
 * @returns The Youtube video metadata
 */
export async function getVideoMetadata(
  videoId: string,
): Promise<RefinedVideoMetadata> {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  const cachedVideo = await redisClient.get(videoId);

  if (null !== cachedVideo) {
    return JSON.parse(cachedVideo) as RefinedVideoMetadata;
  }

  const url = new URL(`https://www.youtube.com/watch?v=${videoId}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    },
  });

  if (200 !== response.status)
    throw new Error(`Unable to access to the given video. (${videoId})`);
  const html = await response.text();

  const videoMetadataMatch = VIDEO_METADATA_REGEX.exec(html);
  if (null === videoMetadataMatch)
    throw new Error(`Unable to find the video details. (${videoId})`);

  const videoMetadata = JSON.parse(videoMetadataMatch[1]) as VideoMetadata;

  return {
    videoId,
    title: sanitizeMetadataValue(videoMetadata.videoDetails.title),
    author: sanitizeMetadataValue(videoMetadata.videoDetails.author),
    thumbnailUrl:
      getBestThumbnailUrl(videoMetadata.videoDetails.thumbnail.thumbnails) ??
      "#",
    date: parseDate(
      new Date(videoMetadata.microformat.playerMicroformatRenderer.publishDate),
    ),
    description: sanitizeMetadataValue(
      videoMetadata.microformat.playerMicroformatRenderer.description
        ?.simpleText ?? videoMetadata.videoDetails.shortDescription,
    ),
  };
}
