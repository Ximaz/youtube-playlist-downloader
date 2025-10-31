import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import runner from "./internal/runner.js";
import type CommunicationService from "../communication/CommunicationService.js";

export default class FFMPEGService {
  constructor(private readonly communicationService?: CommunicationService) {}

  async convertAudioToMPEG(
    audioPath: string,
    videoId: string,
    outputPath: string,
    opts?: {
      thumbnailPath?: string;
      metadata?: RefinedVideoMetadata;
    },
  ): Promise<[string, Readable]> {
    const ffmepgOpts: string[] = [];

    if (undefined !== opts) {
      if (undefined !== opts.thumbnailPath)
        ffmepgOpts.push(
          "-i",
          opts.thumbnailPath,
          "-map",
          "0:a",
          "-map",
          "1:0",
          "-c:v",
          "png",
          "-disposition:v:0",
          "attached_pic",
        );

      if (undefined !== opts.metadata) {
        const mappedMetadata = {
          artist: opts.metadata.author,
          title: opts.metadata.title,
          content_create_date: opts.metadata.date,
          comment: opts.metadata.description.slice(0, 255),
          year: new Date(opts.metadata.date).getFullYear().toString(),
          "©day": opts.metadata.date,
        };
        for (const [k, v] of Object.entries(mappedMetadata))
          ffmepgOpts.push("-metadata", `${k}=${v}`);
      }
    }

    const ffmpegOptions = [
      "-y",
      "-i",
      audioPath,
      ...ffmepgOpts,
      "-c:a",
      "aac",
      outputPath,
    ];

    await runner(ffmpegOptions, ({ total, processed }) => {
      this.communicationService?.sendConvertProgress({
        total,
        processed,
        type: "CONVERT",
        videoId,
      });
    });

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }

  async convertVideoToMPEG(
    videoPath: string,
    videoId: string,
    outputPath: string,
  ): Promise<[string, Readable]> {
    await runner(
      [
        "-y",
        "-i",
        videoPath,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        outputPath,
      ],
      ({ total, processed }) => {
        this.communicationService?.sendConvertProgress({
          total,
          processed,
          type: "CONVERT",
          videoId,
        });
      },
    );

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }

  async mergeAudioAndVideoStreams(
    audioPath: string,
    videoPath: string,
    videoId: string,
    outputPath: string,
  ): Promise<[string, Readable]> {
    await runner(
      [
        "-y",
        "-i",
        audioPath,
        "-i",
        videoPath,
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        outputPath,
      ],
      ({ total, processed }) => {
        this.communicationService?.sendConvertProgress({
          total,
          processed,
          type: "CONVERT",
          videoId,
        });
      },
    );

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }

  async mergeAudioAndVideoStreamsToMPEG(
    audioPath: string,
    videoPath: string,
    videoId: string,
    outputPath: string,
  ): Promise<[string, Readable]> {
    await runner(
      [
        "-y",
        "-i",
        audioPath,
        "-i",
        videoPath,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        outputPath,
      ],
      ({ total, processed }) => {
        this.communicationService?.sendConvertProgress({
          total,
          processed,
          type: "CONVERT",
          videoId,
        });
      },
    );

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }
}
