import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DOWNLOAD_VIDEOS_WORKER_PATH = path.join(
  __dirname,
  "download-videos.js",
);
