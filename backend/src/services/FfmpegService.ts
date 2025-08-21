import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import type { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import type CommunicationService from "./CommunicationService.js";
import type { ConvertWebsocketServiceMessage } from "./CommunicationService.js";

export default class FfmpegService {
  // This regex is applied over a string that contains multiple lines, thus it
  // requires the 'm' modifier for multiline matching.
  private static readonly DURATION_REGEX =
    /^(?:(?:\s+)?Duration:(?:\s+)?)?(\d+):(\d+):(\d+)\.(\d+)/m;

  private static readonly FRAME_REGEX = /frame=.+time=(\d+):(\d+):(\d+)\.(\d+)/;

  constructor(private readonly communicationService?: CommunicationService) {}

  private static convertTimeToSeconds(
    hours: number,
    minutes: number,
    seconds: number,
    milliseconds: number,
  ) {
    return hours * 60 * 60 + minutes * 60 + seconds + milliseconds / 100;
  }

  private static getSecondsFromDurationLine(
    durationLine: string,
  ): number | null {
    const durationMatch = FfmpegService.DURATION_REGEX.exec(durationLine);
    if (!durationMatch) return null;
    const hours = +durationMatch[1];
    const minutes = +durationMatch[2];
    const seconds = +durationMatch[3];
    const milliseconds = +durationMatch[4];
    return FfmpegService.convertTimeToSeconds(
      hours,
      minutes,
      seconds,
      milliseconds,
    );
  }

  private static getSecondsFromFrameLine(frameLine: string): number | null {
    const frameMatch = FfmpegService.FRAME_REGEX.exec(frameLine);
    if (!frameMatch) return null;
    const hours = +frameMatch[1];
    const minutes = +frameMatch[2];
    const seconds = +frameMatch[3];
    const milliseconds = +frameMatch[4];
    return FfmpegService.convertTimeToSeconds(
      hours,
      minutes,
      seconds,
      milliseconds,
    );
  }

  private ffmpegRunner(args: string[], videoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let duration: number | null = null; // in seconds

      execFile(ffmpegPath as unknown as string, args, (error: Error | null) => {
        if (null === error) resolve();
        else {
          console.error(error);
          reject(new Error(error.message, { cause: error.cause }));
        }
      }).stderr?.on("data", (chunk) => {
        if (null === duration) {
          duration = FfmpegService.getSecondsFromDurationLine(chunk as string);
          return void 0;
        }

        const frame = FfmpegService.getSecondsFromFrameLine(chunk as string);
        if (null === frame) return void 0;

        if (this.communicationService) {
          const progress: ConvertWebsocketServiceMessage = {
            type: "CONVERT",
            videoId,
            total: duration,
            processed: frame,
          };
          this.communicationService.sendConvertProgress(progress);
        }
      });
    });
  }

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

    console.log(ffmpegOptions);

    await this.ffmpegRunner(ffmpegOptions, videoId);

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }

  async convertVideoToMPEG(
    videoPath: string,
    videoId: string,
    outputPath: string,
  ): Promise<[string, Readable]> {
    await this.ffmpegRunner(
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
      videoId,
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
    await this.ffmpegRunner(
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
      videoId,
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
    await this.ffmpegRunner(
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
      videoId,
    );

    const outputStream = createReadStream(outputPath);

    return [outputPath, outputStream];
  }
}
