import { Injectable } from '@nestjs/common';
import {
  type MediaSelection,
  type OutputFormat,
  type VideoStep,
  type WorkSelector,
  workKey,
} from '@ypd/shared';

import { CacheService } from '../cache/cache.service';

/** Result of one work item (videoId, selection, format) — global, not per-batch. */
export interface WorkResult {
  videoId: string;
  selection: MediaSelection;
  format: OutputFormat;
  status: VideoStep;
  /** S3 key of the deliverable artifact. */
  key?: string;
  /** Final extension used for the archive entry (m4a/mp4/weba/webm). */
  ext?: string;
  title?: string;
  error?: string;
}

/** Thin grouping that ties a download request to its downloadable videos for the archive.
 *  `sessionId` is recorded when the batch was created by a signed-in user, so the archive
 *  route can refuse cross-session access (defence in depth on top of the UUID capability). */
export interface BatchGroup {
  batchId: string;
  videoIds: string[];
  selection: MediaSelection;
  format: OutputFormat;
  createdAt: string;
  sessionId?: string;
}

const TTL_SECONDS = 6 * 60 * 60;
const resultKey = (videoId: string, selection: MediaSelection, format: OutputFormat): string =>
  `result:${workKey(videoId, selection, format)}`;

/**
 * Per-work-item state in Valkey. A work item is processed once regardless of how many
 * playlists reference it, so results are keyed by (videoId, selection, format) — never by
 * batch. A `BatchGroup` only records which videos a request bundles for its archive link.
 */
@Injectable()
export class WorkStore {
  constructor(private readonly cache: CacheService) {}

  setResult(result: WorkResult): Promise<void> {
    return this.cache.setJson(
      resultKey(result.videoId, result.selection, result.format),
      result,
      TTL_SECONDS,
    );
  }

  getResult(
    videoId: string,
    selection: MediaSelection,
    format: OutputFormat,
  ): Promise<WorkResult | null> {
    return this.cache.getJson<WorkResult>(resultKey(videoId, selection, format));
  }

  async getResults(selector: WorkSelector): Promise<WorkResult[]> {
    // One MGET round-trip instead of N independent GETs — meaningfully cheaper for the
    // archive entry resolver and WS subscribe replay over 100+ video playlists.
    const keys = selector.videoIds.map((videoId) =>
      resultKey(videoId, selector.selection, selector.format),
    );
    const values = await this.cache.mgetJson<WorkResult>(keys);
    return values.filter((r): r is WorkResult => r !== null);
  }

  createBatch(group: BatchGroup): Promise<void> {
    return this.cache.setJson(`batch:${group.batchId}`, group, TTL_SECONDS);
  }

  getBatch(batchId: string): Promise<BatchGroup | null> {
    return this.cache.getJson<BatchGroup>(`batch:${batchId}`);
  }
}
