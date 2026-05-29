import { type ChildProcess, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

export type ProgressFn = (pct: number) => void;

/** Skip a progress emission if neither >= 2 percentage points have moved nor 250 ms passed.
 *  Each emission turns into a BullMQ publish + WS broadcast — a 5-min convert produces 300+
 *  events per ffmpeg run otherwise. */
const PROGRESS_MIN_DELTA = 2;
const PROGRESS_MIN_MS = 250;

/** Thin wrapper around the ffmpeg binary (fluent-ffmpeg is deprecated). Each method
 *  builds the arg list for one conversion and streams progress via `-progress pipe:1`.
 *
 *  Spawned ffmpeg children are tracked so `OnModuleDestroy` (enabled by main.ts's
 *  enableShutdownHooks) can send SIGTERM → SIGKILL during graceful shutdown — otherwise
 *  Docker SIGKILLs the cgroup, but standalone deployments would orphan ffmpeg processes. */
@Injectable()
export class FfmpegService implements OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly children = new Set<ChildProcess>();
  /** Each ffmpeg run gets max(1, floor(cores / convertConcurrency)) threads so concurrent
   *  conversions don't oversubscribe the CPU. Computed once at construction. */
  private readonly threadsPerJob: number;

  constructor(config: AppConfigService) {
    const cpus = availableParallelism();
    const convertConcurrency = Math.max(1, config.convertConcurrency);
    this.threadsPerJob = Math.max(1, Math.floor(cpus / convertConcurrency));
  }

  /** weba/opus (or m4a) audio -> m4a/aac, embedding the thumbnail as cover art. */
  audioToM4a(
    audioPath: string,
    thumbnailPath: string | undefined,
    outPath: string,
    durationSeconds: number | undefined,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const args = ['-threads', String(this.threadsPerJob), '-i', audioPath];
    if (thumbnailPath) args.push('-i', thumbnailPath);
    args.push('-map', '0:a', '-c:a', 'aac', '-b:a', '256k');
    if (thumbnailPath) {
      args.push('-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    }
    args.push('-movflags', '+faststart', outPath);
    return this.#run(args, durationSeconds, onProgress);
  }

  /** webm/vp9 video-only -> mp4/h264 (no audio). */
  videoToMp4(
    videoPath: string,
    outPath: string,
    durationSeconds: number | undefined,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const args = [
      '-threads',
      String(this.threadsPerJob),
      '-i',
      videoPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-x264-params',
      `threads=${this.threadsPerJob}`,
      '-an',
      '-movflags',
      '+faststart',
      outPath,
    ];
    return this.#run(args, durationSeconds, onProgress);
  }

  /** Mux video+audio into mp4, re-encoding video to h264 and audio to aac. */
  muxToMp4(
    videoPath: string,
    audioPath: string,
    outPath: string,
    durationSeconds: number | undefined,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const args = [
      '-threads',
      String(this.threadsPerJob),
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-x264-params',
      `threads=${this.threadsPerJob}`,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outPath,
    ];
    return this.#run(args, durationSeconds, onProgress);
  }

  /** Mux video + audio without re-encoding (the "merged original" path). The output
   *  container is inferred by ffmpeg from `outPath`'s extension: `.webm` for vp8/vp9/av1
   *  + opus, `.mkv` (matroska) otherwise — webm rejects h264/aac etc. with
   *  "Only VP8 or VP9 or AV1 video and Vorbis or Opus audio are supported for WebM",
   *  matroska accepts anything. Both stay `-c copy` so it's still "original". */
  muxOriginal(
    videoPath: string,
    audioPath: string,
    outPath: string,
    durationSeconds: number | undefined,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const args = [
      '-threads',
      String(this.threadsPerJob),
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c',
      'copy',
      outPath,
    ];
    return this.#run(args, durationSeconds, onProgress);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.children.size === 0) return;
    this.logger.log(`stopping ${this.children.size} ffmpeg child process(es)`);
    for (const child of this.children) {
      child.kill('SIGTERM');
    }
    // Give children a moment to flush + exit, then SIGKILL anything that's still alive.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    for (const child of this.children) {
      if (!child.killed) child.kill('SIGKILL');
    }
  }

  #run(
    args: string[],
    durationSeconds: number | undefined,
    onProgress?: ProgressFn,
  ): Promise<void> {
    const fullArgs = [
      '-hide_banner',
      '-y',
      '-loglevel',
      'error',
      '-progress',
      'pipe:1',
      '-nostats',
      ...args,
    ];
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', fullArgs);
      this.children.add(proc);
      let stderr = '';
      let buffer = '';
      let lastEmitted = -1;
      let lastEmittedAt = 0;
      const emit = (pct: number): void => {
        const now = Date.now();
        const delta = Math.abs(pct - lastEmitted);
        if (delta < PROGRESS_MIN_DELTA && now - lastEmittedAt < PROGRESS_MIN_MS && pct < 100) {
          return;
        }
        lastEmitted = pct;
        lastEmittedAt = now;
        onProgress?.(pct);
      };

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const [key, value] = line.split('=');
          if (key === 'out_time_us' && onProgress && durationSeconds && durationSeconds > 0) {
            const seconds = Number(value) / 1_000_000;
            const pct = Math.min(99, Math.round((seconds / durationSeconds) * 100));
            if (Number.isFinite(pct) && pct >= 0) emit(pct);
          } else if (key === 'progress' && value === 'end' && onProgress) {
            emit(100);
          }
        }
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('error', (err) => {
        this.children.delete(proc);
        reject(err);
      });
      proc.on('close', (code) => {
        this.children.delete(proc);
        if (code === 0) {
          resolve();
        } else {
          this.logger.error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`);
          reject(new Error(`ffmpeg failed (exit ${code})`));
        }
      });
    });
  }
}
