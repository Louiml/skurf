import nacl from "tweetnacl"
import { toB64 } from "../src/lib/crypto/protocol"
import { x3dhInitiator, x3dhResponder, Ratchet } from "../src/lib/crypto/protocol"
import { io } from "socket.io-client"

const BASE = "http://localhost:3000"
const jars = new Map<string, string>()

async function call(user: string, path: string, init?: RequestInit & { json?: unknown }) {
  const headers: Record<string, string> = { ...(init?.headers as any) }
  const cookie = jars.get(user)
  if (cookie) headers.Cookie = cookie
  let body = init?.body
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(init.json)
  }
  if (!init?.body) headers["x-device-id"] = devices.get(user)?.deviceId ?? ""
  else if (typeof init.body === "string") headers["x-device-id"] = devices.get(user)?.deviceId ?? ""
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body })
  const setCookie = res.headers.get("set-cookie")
  if (setCookie) jars.set(user, setCookie.split(";")[0])
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`)
  return data
}

interface Dev {
  deviceId: string
  identity: nacl.BoxKeyPair
  signing: nacl.SignKeyPair
  spk: nacl.BoxKeyPair
  opks: Map<number, nacl.BoxKeyPair>
}

const devices = new Map<string, Dev>()

async function registerDevice(user: string) {
  const identity = nacl.box.keyPair()
  const signing = nacl.sign.keyPair()
  const spk = nacl.box.keyPair()
  const sig = nacl.sign.detached(spk.publicKey, signing.secretKey)
  const opks = new Map<number, nacl.BoxKeyPair>()
  const oneTime: Array<{ keyId: number; publicKey: string }> = []
  for (let i = 1; i <= 10; i++) {
    const opk = nacl.box.keyPair()
    opks.set(i, opk)
    oneTime.push({ keyId: i, publicKey: toB64(opk.publicKey) })
  }
  const res = await call(user, "/api/keys/device", {
    method: "POST",
    json: {
      name: `smoke-${user}`,
      platform: "web",
      identityKey: toB64(identity.publicKey),
      signingKey: toB64(signing.publicKey),
      registrationId: 1,
      signedPreKeyId: 1,
      signedPreKey: toB64(spk.publicKey),
      signedPreKeySig: toB64(sig),
      oneTimePreKeys: oneTime,
    },
  })
  devices.set(user, { deviceId: res.deviceId, identity, signing, spk, opks })
}

async function main() {
  const aliceName = `alice${Date.now()}`
  const bobName = `bob${Date.now()}`

  await call("alice", "/api/auth/register", { method: "POST", json: { username: aliceName, displayName: "Alice", password: "password123" } })
  await call("bob", "/api/auth/register", { method: "POST", json: { username: bobName, displayName: "Bob", password: "password123" } })
  console.log("✓ registered two users")

  await registerDevice("alice")
  await registerDevice("bob")
  console.log("✓ registered E2EE devices")

  const bobMe = await call("bob", "/api/me")
  const bobId = bobMe.user.id

  const bundleRes = await call("alice", `/api/keys/bundle/${bobId}`)
  const bobBundle = bundleRes.devices[0]
  console.log(`✓ fetched bob's key bundle (opk: ${bobBundle.oneTimePreKeyId})`)

  const chatRes = await call("alice", "/api/chats", { method: "POST", json: { type: "DIRECT", memberUsernames: [bobName] } })
  console.log(`✓ direct chat ${chatRes.existing ? "(existing)" : "(created)"}: ${chatRes.chatId}`)

  const aliceDev = devices.get("alice")!
  const { sk, preKeyMsg } = await x3dhInitiator(aliceDev.identity, bobBundle)
  const aliceRatchet = await Ratchet.initAsInitiator(sk, Buffer.from(bobBundle.signedPreKey, "base64"))
  const wire = await aliceRatchet.encrypt(new TextEncoder().encode(JSON.stringify({ t: "text", text: "hello bob — end to end" })))
  wire.pk = preKeyMsg

  const connectSocket = (user: string) => {
    const dev = devices.get(user)!
    return io(BASE, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      extraHeaders: { Cookie: jars.get(user)! },
      auth: { deviceId: dev.deviceId },
    })
  }

  const aliceSocket = connectSocket("alice")
  const bobSocket = connectSocket("bob")
  await Promise.all([
    new Promise<void>((r) => aliceSocket.on("connect", () => r())),
    new Promise<void>((r) => bobSocket.on("connect", () => r())),
  ])
  console.log("✓ both sockets connected")

  const bobReceived = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for envelope")), 15000)
    bobSocket.on("envelope:new", async (env: any) => {
      try {
        if (env.type !== "MESSAGE") return
        const bobDev = devices.get("bob")!
        const wireMsg = JSON.parse(env.payload)
        const opk = wireMsg.pk?.opkId !== undefined ? bobDev.opks.get(wireMsg.pk.opkId) ?? null : null
        const skBob = await x3dhResponder(bobDev.identity, bobDev.spk, opk, wireMsg.pk)
        const bobRatchet = await Ratchet.initAsResponder(skBob, bobDev.spk)
        const pt = await bobRatchet.decrypt(wireMsg)
        const payload = JSON.parse(new TextDecoder().decode(pt))
        console.log(`✓ bob decrypted: "${payload.text}"`)
        if (payload.text !== "hello bob — end to end") throw new Error("plaintext mismatch")
        bobSocket.emit("receipt:delivered", { envelopeIds: [env.envelopeId] })
        resolve()
        clearTimeout(timer)
      } catch (e) {
        reject(e)
      }
    })
  })

  const aliceDelivered = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for delivery receipt")), 15000)
    aliceSocket.on("receipt:update", (r: any) => {
      if (r.state === "delivered") {
        console.log("✓ alice got delivery receipt (double tick)")
        resolve()
        clearTimeout(timer)
      }
    })
  })

  const ack = await new Promise<any>((resolve, reject) => {
    aliceSocket.emit(
      "message:send",
      {
        chatId: chatRes.chatId,
        type: "TEXT",
        envelopes: [{ toUserId: bobId, toDeviceId: bobBundle.deviceId, payload: JSON.stringify(wire) }],
      },
      (res: any) => (res.ok ? resolve(res) : reject(new Error(res.error)))
    )
  })
  console.log(`✓ server accepted message seq=${ack.message.seq}`)

  await bobReceived
  await aliceDelivered

  const history = await call("bob", `/api/chats/${chatRes.chatId}/messages`)
  console.log(`✓ history fetch: ${history.messages.length} message(s)`)

  aliceSocket.close()
  bobSocket.close()
  console.log("\nE2E SMOKE TEST PASSED")
  process.exit(0)
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err.message)
  process.exit(1)
})
