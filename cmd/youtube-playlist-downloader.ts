import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import YoutubePlaylistDownloader from "@internal/youtube-playlist-downloader";

async function main() {
  const { values } = parseArgs({
    args: process.argv,
    options: {
      "playlist-id": {
        type: "string",
        multiple: false,
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
  if (undefined === values["playlist-id"]) {
    throw new Error("No playlist ID was passed.");
  }
  await mkdir(values["output-folder"], { recursive: true });

  const downloader = await YoutubePlaylistDownloader(
    values["playlist-id"],
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
