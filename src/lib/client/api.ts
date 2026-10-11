const base = ""

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(deviceId() ? { "x-device-id": deviceId()! } : {}),
    },
    credentials: "include",
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  return data as T
}

export function deviceId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("skurf:deviceId")
}

export function setDeviceId(id: string) {
  localStorage.setItem("skurf:deviceId", id)
}

export const GET = <T>(path: string) => api<T>(path)
export const POST = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined })
export const PUT = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined })
export const PATCH = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined })
export const DELETE = <T>(path: string) => api<T>(path, { method: "DELETE" })
