import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import YoutubeVideosDownloader from "@internal/youtube-videos-downloader";

async function main() {
  const { values } = parseArgs({
    args: process.argv,
    options: {
      "video-id": {
        type: "string",
        multiple: true,
      },
      "output-folder": {
        type: "string",
        default: path.join(".", "output"),
        short: "o",
        multiple: false,
      },
      "process-per-batch": {
        type: "string",
        default: "3",
        multiple: false,
      },
      audio: {
        type: "boolean",
        default: true,
        short: "a",
        multiple: false,
      },
      video: {
        type: "boolean",
        default: true,
        short: "v",
        multiple: false,
      },
    },
    strict: true,
    allowPositionals: true,
  });

  const processPerBatch = parseInt(values["process-per-batch"], 10);
  if (isNaN(processPerBatch)) {
    throw new Error("Invalid process-per-batch value.");
  }
  if (processPerBatch < 1) {
    throw new Error("Each batch must at lease have one process.");
  }

  if (undefined === values["video-id"] || 0 === values["video-id"].length) {
    throw new Error("No Youtube video ID was passed.");
  }
  await mkdir(values["output-folder"], { recursive: true });
  const videoIds = values["video-id"].filter(
    (elem, pos) => values["video-id"]!.indexOf(elem) === pos,
  );

  const downloader = await YoutubeVideosDownloader(
    videoIds,
    values["output-folder"],
  );

  const downloadPath = await downloader.download(
    {
      audio: values.audio,
      video: values.video,
    },
    processPerBatch,
    (progress) => {
      console.log(
        `${progress.videoId} - ${progress.type} download progress: ${progress.percentage.toPrecision(2)}%`,
      );
    },
  );

  console.log(`Video downloaded at location ${values["output-folder"]}`);
}

main().catch(console.error);
