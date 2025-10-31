import type { parentPort } from "node:worker_threads";
import z from "zod";
import WebSocket from "ws";
import { WSContext } from "hono/ws";

const downloadWebsocketServiceMessageSchema = z
  .object({
    type: z.literal("DOWNLOAD"),
    videoId: z.string().nonempty(),
    total: z.number().nonnegative().nonoptional(),
    processed: z.number().nonnegative().nonoptional(),
  })
  .refine(({ total, processed }) => total >= processed, {
    error: `The number of processed entries cannot be greater than the total number of entries.`,
  });

export type DownloadWebsocketServiceMessage = z.infer<
  typeof downloadWebsocketServiceMessageSchema
>;

const convertWebsocketServiceMessageSchema = z
  .object({
    type: z.literal("CONVERT"),
    videoId: z.string().nonempty(),
    total: z.number().nonnegative().nonoptional(),
    processed: z.number().nonnegative().nonoptional(),
  })
  .refine(({ total, processed }) => total >= processed, {
    error: `The number of processed entries cannot be greater than the total number of entries.`,
  });

export type ConvertWebsocketServiceMessage = z.infer<
  typeof convertWebsocketServiceMessageSchema
>;

const compressWebsocketServiceMessageSchema = z
  .object({
    type: z.literal("COMPRESS"),
    total: z.number().nonnegative().nonoptional(),
    processed: z.number().nonnegative().nonoptional(),
  })
  .refine(({ total, processed }) => total >= processed, {
    error: `The number of processed entries cannot be greater than the total number of entries.`,
  });

export type CompressWebsocketServiceMessage = z.infer<
  typeof compressWebsocketServiceMessageSchema
>;

interface CloseWebsocketServiceMessage {
  type: "CLOSE";
}

interface ErrorWebsocketServiceMessage {
  type: "ERROR";
  message: string;
  stack?: string;
  cause?: unknown;
}

export type WebsocketServiceMessage =
  | DownloadWebsocketServiceMessage
  | ConvertWebsocketServiceMessage
  | CompressWebsocketServiceMessage
  | CloseWebsocketServiceMessage
  | ErrorWebsocketServiceMessage;

abstract class CommunicationServiceClient {
  abstract send(
    message: ArrayBuffer | string | object,
    debug: boolean,
  ): Promise<void> | void;

  abstract isReady(): boolean;
}

export class CommunicationServiceClientWebsocket
  implements CommunicationServiceClient
{
  constructor(
    private readonly ctx: WSContext,
    private readonly compression: boolean = false,
  ) {}

  send(
    message: ArrayBuffer | string | object,
    debug: boolean,
  ): Promise<void> | void {
    if (!(message instanceof ArrayBuffer) && typeof message !== "string") {
      this.ctx.send(JSON.stringify(message), { compress: this.compression });
      if (debug)
        console.debug(
          `CommunicationServiceClientWebsocket: Message sent, JSON string. (compression = ${this.compression.toString()})`,
        );
    } else {
      this.ctx.send(message, { compress: this.compression });
      if (debug)
        console.debug(
          `CommunicationServiceClientWebsocket: Message sent, ArrayBuffer. (compression = ${this.compression.toString()})`,
        );
    }
  }

  isReady(): boolean {
    return this.ctx.readyState === WebSocket.OPEN;
  }
}

export class CommunicationServiceClientWorker
  implements CommunicationServiceClient
{
  constructor(private readonly ctx: typeof parentPort) {}

  send(
    message: ArrayBuffer | string | object,
    debug: boolean,
  ): Promise<void> | void {
    if (message instanceof ArrayBuffer) {
      this.ctx?.postMessage(message, [message]);
      if (debug)
        console.debug(
          `CommunicationServiceClientWorker: Message sent, ArrayBuffer.`,
        );
    } else {
      this.ctx?.postMessage(message);
      if (debug)
        console.debug(
          `CommunicationServiceClientWorker: Message sent, JSON string.`,
        );
    }
  }

  isReady(): boolean {
    return null !== this.ctx;
  }
}

export default class CommunicationService {
  constructor(
    private readonly ctx: CommunicationServiceClient,
    private readonly debug: boolean = false,
  ) {}

  private sendMessage(message: WebsocketServiceMessage | ArrayBuffer) {
    if (!this.ctx.isReady()) return void 0;
    void this.ctx.send(message, this.debug);
  }

  transferMessage(message: WebsocketServiceMessage | ArrayBuffer) {
    if (this.debug) console.debug("Trying to forward a message ...");
    this.sendMessage(message);
  }

  sendDownloadProgress(message: DownloadWebsocketServiceMessage) {
    if (this.debug) console.debug("Trying to send a DOWNLOAD message ...");

    const { error } = z.safeParse(
      downloadWebsocketServiceMessageSchema,
      message,
    );
    if (error) throw new Error(error.message, { cause: error.cause });

    this.sendMessage(message);
  }

  sendConvertProgress(message: ConvertWebsocketServiceMessage) {
    if (this.debug) console.debug("Trying to send a CONVERT message ...");

    const { error } = z.safeParse(
      convertWebsocketServiceMessageSchema,
      message,
    );
    if (error) throw new Error(error.message, { cause: error.cause });

    this.sendMessage(message);
  }

  sendCompressProgress(message: CompressWebsocketServiceMessage) {
    if (this.debug) console.debug("Trying to send a COMPRESS message ...");

    const { error } = z.safeParse(
      compressWebsocketServiceMessageSchema,
      message,
    );
    if (error) throw new Error(error.message, { cause: error.cause });

    this.sendMessage(message);
  }

  sendCompressedBytes(message: ArrayBuffer) {
    if (this.debug) console.debug("Trying to send an ArrayBuffer message ...");

    this.sendMessage(message);
  }

  sendClose() {
    if (this.debug) console.debug("Trying to send a CLOSE message ...");

    this.sendMessage({
      type: "CLOSE",
    } satisfies CloseWebsocketServiceMessage);
  }

  sendError(error: Error) {
    if (this.debug) console.debug("Trying to send an ERROR message ...");

    this.sendMessage({
      type: "ERROR",
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    } satisfies ErrorWebsocketServiceMessage);
  }

  isReady() {
    return this.ctx.isReady();
  }
}
