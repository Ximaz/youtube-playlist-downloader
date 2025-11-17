import { mkdir } from "node:fs/promises";
import getPlaylistMetadata from "@internal/youtube-api/playlists";
import YoutubeVideosDownloader from "@internal/youtube-videos-downloader";
import type {
  DownloadOptions,
  ProgressCallback,
} from "./youtube-video-downloader";

export default async function YoutubePlaylistDownloader(
  playlistId: string,
  outputPath: string,
) {
  await mkdir(outputPath, { recursive: true });

  return {
    async download(
      downloadOptions: DownloadOptions,
      processPerBatch: number,
      onProgress?: ProgressCallback,
    ) {
      const playlistMetadata = await getPlaylistMetadata(playlistId);
      const downloader = await YoutubeVideosDownloader(
        playlistMetadata.videos.map((video) => video.id),
        outputPath,
      );

      return await downloader.download(
        downloadOptions,
        processPerBatch,
        onProgress,
      );
    },
  };
}
