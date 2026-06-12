import type { ClientToServerEvents, ServerToClientEvents } from '@ypd/shared';
import { io, type Socket } from 'socket.io-client';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Open a Socket.IO connection to the same origin (the Nuxt BFF). Nitro proxies the
 *  `/socket.io` handshake + websocket upgrade to the backend, injecting the session token
 *  from the httpOnly cookie — so the browser never connects to the backend directly. */
export function connectSocket(): TypedSocket {
  // Same-origin: default URL, explicit path. WebSocket-only (no polling): the engine.io polling
  // handshake spans multiple HTTP requests that must hit the SAME backend pod, which would force
  // sticky sessions at the ingress; a single WS upgrade does not. The Valkey Socket.IO adapter
  // already makes room fan-out correct across replicas, so dropping polling needs no affinity.
  return io({ path: '/socket.io', transports: ['websocket'] });
}
