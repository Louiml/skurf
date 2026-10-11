import nacl from "tweetnacl"
import { toB64 } from "../src/lib/crypto/protocol"
import { io } from "socket.io-client"

const BASE = "http://localhost:3000"
let cookie = ""
let deviceId = ""

async function call(path: string, init?: RequestInit & { json?: unknown }) {
  const headers: Record<string, string> = {}
  if (cookie) headers.Cookie = cookie
  if (deviceId) headers["x-device-id"] = deviceId
  let body = init?.body
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body })
  const sc = res.headers.get("set-cookie")
  if (sc) cookie = sc.split(";")[0]
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

async function main() {
  await call("/api/auth/register", { method: "POST", json: { username: `sock${Date.now()}`, displayName: "Sock", password: "password123" } })
  const identity = nacl.box.keyPair()
  const signing = nacl.sign.keyPair()
  const spk = nacl.box.keyPair()
  const sig = nacl.sign.detached(spk.publicKey, signing.secretKey)
  const reg = await call("/api/keys/device", {
    method: "POST",
    json: {
      name: "sock-test",
      platform: "web",
      identityKey: toB64(identity.publicKey),
      signingKey: toB64(signing.publicKey),
      registrationId: 1,
      signedPreKeyId: 1,
      signedPreKey: toB64(spk.publicKey),
      signedPreKeySig: toB64(sig),
      oneTimePreKeys: [{ keyId: 1, publicKey: toB64(nacl.box.keyPair().publicKey) }],
    },
  })
  deviceId = reg.deviceId

  const socket = io(BASE, {
    path: "/socket.io",
    extraHeaders: { Cookie: cookie },
    auth: { deviceId },
  })
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve())
    socket.on("connect_error", (e) => reject(e))
  })
  console.log("connected:", socket.id)

  const ack = await new Promise<any>((resolve) => {
    socket.emit("message:send", { chatId: "nonexistent", type: "TEXT" }, (res: any) => resolve(res))
    setTimeout(() => resolve({ ok: false, error: "NO ACK" }), 8000)
  })
  console.log("ack:", JSON.stringify(ack))

  const saved = await new Promise<any>((resolve) => {
    const chat = null
    socket.emit("typing:update", { chatId: "x", isTyping: true })
    resolve(null)
  })
  socket.close()
  void saved
  process.exit(ack.error === "NO ACK" ? 1 : 0)
}

main().catch((e) => {
  console.error("FAILED:", e.message)
  process.exit(1)
})
