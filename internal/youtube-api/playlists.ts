import Innertube, { UniversalCache } from "youtubei.js";
import { getBestThumbnailUrl } from "@internal/youtube-api/thumbnail";

const PLAYLIST_METADATA_REGEX =
  /<script[^>]+>var ytInitialData = (\{.+\});<\/script>/;

export async function getPlaylistVideos(
  playlistId: string,
): Promise<{ id: string; title: string; author: string; thumbnail: string }[]> {
  const innertube = await Innertube.create({
    cache: new UniversalCache(true),
  });

  try {
    let playlistPage = await innertube.getPlaylist(playlistId);
    const videoIds: {
      id: string;
      title: string;
      author: string;
      thumbnail: string;
    }[] = [];
    while (playlistPage.videos.length > 0) {
      videoIds.push(
        ...(
          playlistPage.videos.filter(
            (video) => video.type === "PlaylistVideo",
          ) as unknown as {
            id: string;
            title: { text: string };
            author: { name: string };
            thumbnails: { url: string; width: number; height: number }[];
          }[]
        ).map((video) => ({
          id: video.id,
          title: video.title.text,
          author: video.author.name,
          thumbnail: getBestThumbnailUrl(video.thumbnails),
        })),
      );
      if (!playlistPage.has_continuation) return videoIds;
      playlistPage = await playlistPage.getContinuation();
    }
    return [];
  } catch {
    throw new Error(
      `Unable to access the playlist ${playlistId}. Make sure it is either Public or Unlisted.`,
    );
  }
}

class PlaylistNotFoundError extends Error {
  constructor(playlistId: string) {
    super();
    this.message = `Unable to find the playlist details. Make sure the playlist visibility is at least 'unlisted'. (${playlistId})`;
  }
}

export default async function getPlaylistMetadata(
  playlistId: string,
): Promise<RefinedPlaylistMetadata> {
  const url = new URL(`https://www.youtube.com/playlist?list=${playlistId}`);

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    },
  });

  if (200 !== response.status) {
    throw new PlaylistNotFoundError(playlistId);
  }
  const html = await response.text();

  const playlistDetailsMatch = PLAYLIST_METADATA_REGEX.exec(html);
  if (null === playlistDetailsMatch) {
    throw new PlaylistNotFoundError(playlistId);
  }

  const playlistDetails = playlistDetailsMatch[1];
  if (undefined === playlistDetails) {
    throw new PlaylistNotFoundError(playlistId);
  }

  const playlistMetadata = JSON.parse(playlistDetails) as PlaylistMetadata;

  if (undefined === playlistMetadata.metadata) {
    throw new PlaylistNotFoundError(playlistId);
  }

  const videos = await getPlaylistVideos(playlistId);

  return {
    playlistId,
    title: playlistMetadata.metadata.playlistMetadataRenderer.title,
    thumbnailUrl: getBestThumbnailUrl(
      playlistMetadata.microformat.microformatDataRenderer.thumbnail.thumbnails,
    ),
    videos,
  };
}
