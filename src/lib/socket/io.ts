import type { Server } from "socket.io"

const globalAny = globalThis as unknown as { __io?: Server }

export function setIO(io: Server) {
  globalAny.__io = io
}

export function getIO(): Server | null {
  return globalAny.__io ?? null
}
