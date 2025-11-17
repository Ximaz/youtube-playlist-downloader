import path from "node:path";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import YoutubeVideoDownloader from "@internal/youtube-video-downloader";

async function main() {
  const { values } = parseArgs({
    args: process.argv,
    options: {
      "video-id": {
        type: "string",
        multiple: false,
      },
      "output-folder": {
        type: "string",
        default: path.join(".", "output"),
        short: "o",
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

  if (undefined === values["video-id"]) {
    throw new Error("No Youtube video ID was passed.");
  }

  await mkdir(values["output-folder"], { recursive: true });

  const downloader = await YoutubeVideoDownloader(
    values["video-id"],
    values["output-folder"],
  );

  const downloadPath = await downloader.download(
    {
      audio: values.audio,
      video: values.video,
    },
    (progress) => {
      console.log(
        `${progress.type} download progress: ${progress.percentage.toPrecision(2)}%`,
      );
    },
  );

  console.log(`Video downloaded at location ${values["output-folder"]}`);
}

main().catch(console.error);
