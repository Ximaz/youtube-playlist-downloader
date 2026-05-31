import type { ClientToServerEvents, ServerToClientEvents } from '@ypd/shared';
import { io, type Socket } from 'socket.io-client';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Open a Socket.IO connection to the same origin (the Nuxt BFF). Nitro proxies the
 *  `/socket.io` handshake + websocket upgrade to the backend, injecting the session token
 *  from the httpOnly cookie — so the browser never connects to the backend directly. */
export function connectSocket(): TypedSocket {
  // Same-origin: default URL, explicit path. Allow polling fallback if the WS upgrade is blocked.
  return io({ path: '/socket.io', transports: ['websocket', 'polling'] });
}
