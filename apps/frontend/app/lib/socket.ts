import type { ClientToServerEvents, ServerToClientEvents } from '@ypd/shared';
import { io, type Socket } from 'socket.io-client';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Open a socket.io connection to the backend. Same origin as the REST helpers
 *  (BACKEND_URL applies to both — Socket.IO mounts on the NestJS HTTP server).
 *  Read from Nuxt's runtime config so the URL reflects the container's current
 *  env, not the build args. */
export function connectSocket(): TypedSocket {
  const url = useRuntimeConfig().public.backendUrl;
  // Allow polling fallback so the connection still works if the WS upgrade is blocked.
  return io(url, { transports: ['websocket', 'polling'] });
}
