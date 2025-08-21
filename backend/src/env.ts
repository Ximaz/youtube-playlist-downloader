import "dotenv/config";
import StorageServiceS3 from "./services/StorageServiceS3.js";
import { createClient } from "@redis/client";

export const PORT = parseInt(process.env["PORT"] ?? "NaN") || 3000;

export const WORKERS_CAPACITY =
  parseInt(process.env["WORKERS_CAPACITY"] ?? "NaN") || 3;

export const storageServiceS3 = new StorageServiceS3({
  region: process.env["S3_API_REGION"] as string,
  endpoint: process.env["S3_API_ENDPOINT"] as string,
  forcePathStyle: true,
  accessKeyId: process.env["S3_API_ACCESS_KEY_ID"] as string,
  secretAccessKey: process.env["S3_API_SECRET_ACCESS_KEY"] as string,
});

export const redisClient = createClient({
  socket: {
    host: process.env["REDIS_HOST"] as string,
    port: parseInt(process.env["PORT"] ?? "NaN") || 6379,
  },
});
