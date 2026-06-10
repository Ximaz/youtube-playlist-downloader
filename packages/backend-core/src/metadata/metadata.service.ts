import { Injectable } from '@nestjs/common';
import type { PlaylistMetadata, VideoMetadata } from '@ypd/shared';

import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/app-config.service';
import { ProviderClientService } from '../providers/provider-client.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class MetadataService {
  private readonly ttl: number;

  constructor(
    private readonly providers: ProviderClientService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    config: AppConfigService,
  ) {
    this.ttl = config.cache.metadataTtlSeconds;
  }

  /** Cache-aside (Valkey, 24h). On miss, also persist `{id}.json` to S3 as the durable
   *  title source used later by the archive route. */
  async getVideo(videoId: string): Promise<VideoMetadata> {
    const key = `video:${videoId}`;
    const cached = await this.cache.getJson<VideoMetadata>(key);
    if (cached) return cached;

    const metadata = await this.providers.getVideoMetadata(videoId);
    await Promise.all([
      this.cache.setJson(key, metadata, this.ttl),
      this.storage.putJson(`${videoId}.json`, metadata),
    ]);
    return metadata;
  }

  async getPlaylist(playlistId: string): Promise<PlaylistMetadata> {
    const key = `playlist:${playlistId}`;
    const cached = await this.cache.getJson<PlaylistMetadata>(key);
    if (cached) return cached;

    const metadata = await this.providers.getPlaylist(playlistId);
    await this.cache.setJson(key, metadata, this.ttl);
    return metadata;
  }
}
