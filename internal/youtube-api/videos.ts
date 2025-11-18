import { getBestThumbnailUrl } from "@internal/youtube-api/thumbnail";
import type { RefinedVideoMetadata, VideoMetadata } from "./video-typings";

/**
 * This RegExp is executed against the HTML content of a Youtube video page in
 * order to detect and extract the related metadata. It checks for an optional
 * 'head' element query because it is present on the 'Unlisted' video pages, but
 * not on regular pages, leading to ignored result.
 */
const VIDEO_METADATA_REGEX =
  /var ytInitialPlayerResponse = (\{.+\});(?:var head = document\.getElementsByTagName\('head'\)\[0\];)?\s?var meta = document\.createElement\('meta'\);/;

function parseDate(date: Date) {
  return date.toISOString().split("T")[0]!;
}

class VideoNotFoundError extends Error {
  constructor(videoId: string) {
    super();
    this.message = `Unable to find the video details. (${videoId})`;
  }
}

export default async function getVideoMetadata(
  videoId: string,
): Promise<RefinedVideoMetadata> {
  const url = new URL(`https://www.youtube.com/watch?v=${videoId}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    },
  });

  if (200 !== response.status) {
    throw new VideoNotFoundError(videoId);
  }
  const html = await response.text();

  const videoMetadataMatch = VIDEO_METADATA_REGEX.exec(html);
  if (null === videoMetadataMatch) {
    throw new VideoNotFoundError(videoId);
  }

  const rawVideoMetadata = videoMetadataMatch[1];
  if (undefined === rawVideoMetadata) {
    throw new VideoNotFoundError(videoId);
  }
  const videoMetadata = JSON.parse(rawVideoMetadata) as VideoMetadata;

  return {
    videoId,
    title: videoMetadata.videoDetails.title,
    author: videoMetadata.videoDetails.author.replace(/[^\x20-\x7E]+/gi, "_"),
    thumbnailUrl: getBestThumbnailUrl(
      videoMetadata.videoDetails.thumbnail.thumbnails,
    ),
    // date: parseDate(
    //   new Date(videoMetadata.microformat.playerMicroformatRenderer.publishDate),
    // ),
    // description: (
    //   videoMetadata.microformat.playerMicroformatRenderer.description
    //     ?.simpleText ?? videoMetadata.videoDetails.shortDescription
    // ).replace(/[^\x20-\x7E]+/gi, "_"),
  };
}
