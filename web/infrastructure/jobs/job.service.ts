import { randomUUID, type UUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { WSContext } from "hono/ws";
import type { JobTask } from "@web/domain/JobTask";
import JobQueue from "@web/domain/JobQueue";
import CommunicationService, {
  CommunicationServiceClientWebsocket,
  type WebsocketServiceMessage,
} from "@web/infrastructure/communication/communication.service";
import { WORKERS_CAPACITY } from "@web/infrastructure/config/env";

export default class JobsService {
  private static readonly MAX_RUNNING_JOBS: number = WORKERS_CAPACITY;
  private static instance: JobsService | null = null;

  private readonly jobQueue: JobQueue = new JobQueue();
  private readonly pipes: Map<UUID, CommunicationService> = new Map();

  static getInstance(): JobsService {
    if (null === JobsService.instance) {
      JobsService.instance = new JobsService();
    }

    return JobsService.instance;
  }

  scheduleJob(workerPath: string, workerParams: unknown) {
    const jobId = randomUUID();

    const start = () => {
      const worker = new Worker(workerPath, {
        env: process.env,
        name: jobId,
        workerData: workerParams,
      });

      worker.on("message", (message: WebsocketServiceMessage | ArrayBuffer) => {
        const pipe = this.pipes.get(jobId);

        if (message instanceof ArrayBuffer) {
          pipe?.transferMessage(message);
          return void 0;
        }

        if (message.type === "ERROR") {
          pipe?.transferMessage(message);
          void worker.terminate();
          return void 0;
        }

        pipe?.transferMessage(message);
      });

      worker.on("messageerror", console.trace);

      worker.once("error", console.trace);

      worker.once("exit", () => {
        this.closePipe(jobId);
        this.jobQueue.markDone(jobId);
        this.safeStartJob();
      });

      return worker;
    };

    this.jobQueue.add(jobId, start);

    return jobId;
  }

  bindWebsocket(jobId: UUID, websocket: WSContext) {
    this.jobQueue.bindWebsocket(jobId, websocket);

    this.pipes.set(
      jobId,
      new CommunicationService(
        new CommunicationServiceClientWebsocket(websocket, true),
      ),
    );

    this.safeStartJob();
  }

  cancel(jobId: UUID) {
    this.jobQueue.cancel(jobId);
    this.closePipe(jobId);
  }

  private closePipe(jobId: UUID) {
    const currentPipe = this.pipes.get(jobId);
    if (undefined === currentPipe) return void 0;

    this.pipes.delete(jobId);
  }

  private safeStartJob() {
    const readyJobs: JobTask[] = [];
    do {
      const running = this.jobQueue.getRunningJobs().length;
      if (running >= JobsService.MAX_RUNNING_JOBS) return void 0;

      const slots = JobsService.MAX_RUNNING_JOBS - running;
      const readyJobs = this.jobQueue.getReadyJobs().slice(0, slots);

      for (const job of readyJobs) {
        this.jobQueue.markRunning(job.id);
        const worker = job.start();

        worker.postMessage("start");
      }
    } while (readyJobs.length > 0);
  }
}
