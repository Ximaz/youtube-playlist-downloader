export type WebsocketMessage =
  | {
      type: "DOWNLOAD" | "CONVERT";
      videoId: string;
      total: number;
      processed: number;
    }
  | {
      type: "COMPRESS";
      total: number;
      processed: number;
    }
  | {
      type: "ERROR";
      message: string;
      stack?: string;
      cause?: unknown;
    }
  | {
      type: "CLOSE";
    };
