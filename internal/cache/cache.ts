import type { RefinedPlaylistMetadata } from "@internal/youtube-api/playlist-typings";
import type { RefinedVideoMetadata } from "@internal/youtube-api/video-typings";

export declare interface Cache {
  setVideoMetadata(
    videoId: string,
    videoMetadata: RefinedVideoMetadata,
  ): Promise<void>;

  getVideoMetadata(
    videoId: string,
    forceRefresh: boolean,
  ): Promise<RefinedVideoMetadata | null>;

  setPlaylistMetadata(
    playlistId: string,
    playlistMetadata: RefinedPlaylistMetadata,
  ): Promise<void>;

  getPlaylistMetadata(
    playlistId: string,
    forceRefresh: boolean,
  ): Promise<RefinedPlaylistMetadata | null>;
}
