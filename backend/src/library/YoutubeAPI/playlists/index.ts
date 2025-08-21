import Innertube, { UniversalCache } from "youtubei.js";
import YoutubeAPI from "../index.js";

const PLAYLIST_METADATA_REGEX =
  /<script[^>]+>var ytInitialData = (\{.+\});<\/script>/;

async function getPlaylistVideoIds(playlistId: string): Promise<string[]> {
  const innertube = await Innertube.create({
    cache: new UniversalCache(true),
    retrieve_innertube_config: true,
  });

  try {
    let playlistPage = await innertube.getPlaylist(playlistId);
    const videoIds: string[] = [];
    while (playlistPage.videos.length > 0) {
      // Type PlaylistVideo is not exported, so we have to use a cast here.
      videoIds.push(
        ...playlistPage.videos.map((video) => (video as { id: string }).id),
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

function getBestThumbnailUrl(
  thumbnails: { url: string; width: number; height: number }[],
) {
  return thumbnails
    .sort((t1, t2) => t1.width * t1.height - t2.width * t2.height)
    .at(-1)?.url;
}

async function getPlaylistMetadata(
  playlistId: string,
): Promise<RefinedPlaylistMetadata> {
  const url = new URL(`https://www.youtube.com/playlist?list=${playlistId}`);

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
    },
  });

  if (200 !== response.status)
    throw new Error(`Unable to access to the given playlist. (${playlistId})`);

  const html = await response.text();

  const playlistDetailsMatch = PLAYLIST_METADATA_REGEX.exec(html);
  if (null === playlistDetailsMatch)
    throw new Error(`Unable to find the playlist details. (${playlistId})`);

  const playlistMetadata = JSON.parse(
    playlistDetailsMatch[1],
  ) as PlaylistMetadata;

  return {
    playlistId,
    title: playlistMetadata.metadata.playlistMetadataRenderer.title,
    thumbnailUrl:
      getBestThumbnailUrl(
        playlistMetadata.microformat.microformatDataRenderer.thumbnail
          .thumbnails,
      ) ?? "#",
    videoIds: await YoutubeAPI.PlaylistAPI.getPlaylistVideoIds(playlistId),
  };
}

export default { getPlaylistVideoIds, getPlaylistMetadata };
