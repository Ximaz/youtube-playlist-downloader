import { mkdir } from "node:fs/promises";
import YoutubeVideoDownloader, {
  type DownloadOptions,
  type ProgressCallback,
} from "@internal/youtube-video-downloader";

export default async function YoutubeVideosDownloader(
  videoIds: string[],
  outputPath: string,
) {
  await mkdir(outputPath, { recursive: true });

  return {
    async download(
      downloadOptions: DownloadOptions,
      processPerBatch: number,
      onProgress?: ProgressCallback,
    ) {
      const batchesLength = Math.ceil(videoIds.length / processPerBatch);

      const batches = await Promise.all(
        Array(batchesLength)
          .fill(null)
          .map(
            async (batch, batchIndex) =>
              await Promise.all(
                videoIds
                  .slice(
                    batchIndex * processPerBatch,
                    batchIndex * processPerBatch +
                      Math.min(
                        processPerBatch,
                        videoIds.length - processPerBatch * batchIndex,
                      ),
                  )
                  .map((videoId) =>
                    YoutubeVideoDownloader(videoId, outputPath),
                  ),
              ),
          ),
      );

      const outputPaths: { videoId: string; audio?: string; video?: string }[] =
        [];
      for (const batch of batches) {
        outputPaths.push(
          ...(await Promise.all(
            batch.map((donwloader) =>
              donwloader.download(downloadOptions, onProgress),
            ),
          )),
        );
      }

      return outputPaths;
    },
  };
}
