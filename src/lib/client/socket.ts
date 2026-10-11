"use client"

import { io, Socket } from "socket.io-client"
import type { ClientToServerEvents, ServerToClientEvents } from "@/lib/socket/events"
import { deviceId } from "./api"

export type SkurfSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: SkurfSocket | null = null

export function getSocket(): SkurfSocket | null {
  return socket
}

export function connectSocket(): Promise<SkurfSocket> {
  if (socket?.connected) return Promise.resolve(socket)
  return new Promise((resolve, reject) => {
    const s = io({
      path: "/socket.io",
      auth: { deviceId: deviceId() },
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
    s.once("connect", () => {
      socket = s
      resolve(s)
    })
    s.once("connect_error", (err) => reject(err))
    s.on("disconnect", () => {
      socket = null
    })
  })
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
