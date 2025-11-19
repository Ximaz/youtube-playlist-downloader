import type { Cache } from "@internal/cache/cache";
import type { RefinedPlaylistMetadata } from "@internal/youtube-api/playlist-typings";
import type { RefinedVideoMetadata } from "@internal/youtube-api/video-typings";
import type { RedisClientType } from "@redis/client";

export default class CacheRedis implements Cache {
  constructor(
    readonly cacheTTL: number, // In seconds
    private readonly redisClient: RedisClientType
  ) {}

  async setVideoMetadata(
    videoId: string,
    videoMetadata: RefinedVideoMetadata
  ): Promise<void> {
    const cacheKey = `videos-${videoId}`;
    await this.redisClient.set(cacheKey, JSON.stringify(videoMetadata), {
      expiration: {
        type: "EX",
        value: this.cacheTTL,
      },
      GET: true,
    });
  }

  async getVideoMetadata(
    videoId: string,
    forceRefresh: boolean = false
  ): Promise<RefinedVideoMetadata | null> {
    const cacheKey = `videos-${videoId}`;
    if (forceRefresh) {
      await this.redisClient.del(cacheKey);
      return null;
    }

    const cached = await this.redisClient.get(cacheKey);
    if (null !== cached) {
      return JSON.parse(cached);
    }
    return null;
  }

  async setPlaylistMetadata(
    playlistId: string,
    playlistMetadata: RefinedPlaylistMetadata
  ): Promise<void> {
    const cacheKey = `playlists-${playlistId}`;
    await this.redisClient.set(cacheKey, JSON.stringify(playlistMetadata), {
      expiration: {
        type: "EX",
        value: this.cacheTTL,
      },
      GET: true,
    });
  }

  async getPlaylistMetadata(
    playlistId: string,
    forceRefresh: boolean = false
  ): Promise<RefinedPlaylistMetadata | null> {
    const cacheKey = `playlists-${playlistId}`;
    if (forceRefresh) {
      await this.redisClient.del(cacheKey);
      return null;
    }

    const cached = await this.redisClient.get(cacheKey);
    if (null !== cached) {
      return JSON.parse(cached);
    }
    return null;
  }
}
