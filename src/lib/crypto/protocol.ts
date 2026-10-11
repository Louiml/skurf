import nacl from "tweetnacl"

const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export function toB64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

export const utf8 = (s: string) => enc.encode(s)

async function hmacH(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await subtle().sign("HMAC", k, data as BufferSource))
}

export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length = 32): Promise<Uint8Array> {
  const saltKey = salt.length ? salt : new Uint8Array(32)
  const prk = await hmacH(saltKey, ikm)
  const blocks: Uint8Array[] = []
  let prev: Uint8Array = new Uint8Array(0)
  let i = 1
  let total = 0
  while (total < length) {
    const t = await hmacH(prk, concat(prev, info, new Uint8Array([i])))
    blocks.push(t)
    prev = t
    total += t.length
    i++
  }
  const okm = concat(...blocks)
  return okm.slice(0, length)
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", data as BufferSource))
}

async function aeadDerive(key: Uint8Array) {
  const out = await hkdf(key, utf8("skurf-aead"), utf8("aead"), 44)
  return { encKey: out.slice(0, 32), iv: out.slice(32, 44) }
}

export async function aeadSeal(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const { encKey, iv } = await aeadDerive(key)
  const k = await subtle().importKey("raw", encKey as BufferSource, { name: "AES-GCM" }, false, ["encrypt"])
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: (aad ?? new Uint8Array(0)) as BufferSource },
    k,
    plaintext as BufferSource
  )
  return new Uint8Array(ct)
}

export async function aeadOpen(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const { encKey, iv } = await aeadDerive(key)
  const k = await subtle().importKey("raw", encKey as BufferSource, { name: "AES-GCM" }, false, ["decrypt"])
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: iv.slice(0, 12) as BufferSource, additionalData: (aad ?? new Uint8Array(0)) as BufferSource },
    k,
    sealed as BufferSource
  )
  return new Uint8Array(pt)
}

// ─── X3DH ───────────────────────────────────────────────────────────────────

export interface KeyBundle {
  identityKey: string
  signingKey: string
  signedPreKeyId: number
  signedPreKey: string
  signedPreKeySig: string
  oneTimePreKeyId?: number
  oneTimePreKey?: string
}

export interface PreKeyMessage {
  ik: string
  ek: string
  spkId: number
  opkId?: number
}

const X3DH_INFO = utf8("skurf-x3dh-v1")

async function deriveSk(parts: (Uint8Array | null)[]) {
  const ikm = concat(...(parts.filter((p) => p !== null) as Uint8Array[]))
  const sk = await hkdf(ikm, new Uint8Array(32), X3DH_INFO, 32)
  return sk
}

export async function x3dhInitiator(
  identityPair: nacl.BoxKeyPair,
  bundle: KeyBundle
): Promise<{ sk: Uint8Array; preKeyMsg: PreKeyMessage }> {
  const spk = fromB64(bundle.signedPreKey)
  const valid = nacl.sign.detached.verify(spk, fromB64(bundle.signedPreKeySig), fromB64(bundle.signingKey))
  if (!valid) throw new Error("Signed prekey signature invalid")
  const eph = nacl.box.keyPair()
  const dh1 = nacl.box.before(spk, identityPair.secretKey)
  const dh2 = nacl.box.before(fromB64(bundle.identityKey), eph.secretKey)
  const dh3 = nacl.box.before(spk, eph.secretKey)
  const dh4 = bundle.oneTimePreKey ? nacl.box.before(fromB64(bundle.oneTimePreKey), eph.secretKey) : null
  const sk = await deriveSk([dh1, dh2, dh3, dh4])
  return {
    sk,
    preKeyMsg: {
      ik: toB64(identityPair.publicKey),
      ek: toB64(eph.publicKey),
      spkId: bundle.signedPreKeyId,
      opkId: bundle.oneTimePreKeyId,
    },
  }
}

export async function x3dhResponder(
  identityPair: nacl.BoxKeyPair,
  spkPair: nacl.BoxKeyPair,
  opkPair: nacl.BoxKeyPair | null,
  msg: PreKeyMessage
): Promise<Uint8Array> {
  const ik = fromB64(msg.ik)
  const ek = fromB64(msg.ek)
  const dh1 = nacl.box.before(ik, spkPair.secretKey)
  const dh2 = nacl.box.before(ek, identityPair.secretKey)
  const dh3 = nacl.box.before(ek, spkPair.secretKey)
  const dh4 = opkPair ? nacl.box.before(ek, opkPair.secretKey) : null
  return deriveSk([dh1, dh2, dh3, dh4])
}

// ─── Double Ratchet ─────────────────────────────────────────────────────────

export interface RatchetHeader {
  dh: string
  pn: number
  n: number
}

export interface WireMessage {
  h?: RatchetHeader
  pk?: PreKeyMessage
  c: string
}

export interface RatchetState {
  rk: string
  cks: string | null
  ckr: string | null
  ns: number
  nr: number
  pn: number
  dhPub: string
  dhSec: string
  dhr: string | null
  skipped: Record<string, string>
}

const MAX_SKIP = 500

async function kdfRk(rk: Uint8Array, dhOut: Uint8Array) {
  const out = await hkdf(dhOut, rk, utf8("skurf-ratchet-rk"), 64)
  return { rk: out.slice(0, 32), ck: out.slice(32) }
}

async function kdfCk(ck: Uint8Array) {
  const mk = await hmacH(ck, new Uint8Array([1]))
  const next = await hmacH(ck, new Uint8Array([2]))
  return { mk, next }
}

export class Ratchet {
  constructor(public state: RatchetState) {}

  static async initAsInitiator(sk: Uint8Array, theirRatchetPub: Uint8Array): Promise<Ratchet> {
    const dhs = nacl.box.keyPair()
    const { rk, ck } = await kdfRk(sk, nacl.box.before(theirRatchetPub, dhs.secretKey))
    return new Ratchet({
      rk: toB64(rk),
      cks: toB64(ck),
      ckr: null,
      ns: 0,
      nr: 0,
      pn: 0,
      dhPub: toB64(dhs.publicKey),
      dhSec: toB64(dhs.secretKey),
      dhr: toB64(theirRatchetPub),
      skipped: {},
    })
  }

  static async initAsResponder(sk: Uint8Array, spkPair: nacl.BoxKeyPair): Promise<Ratchet> {
    return new Ratchet({
      rk: toB64(sk),
      cks: null,
      ckr: null,
      ns: 0,
      nr: 0,
      pn: 0,
      dhPub: toB64(spkPair.publicKey),
      dhSec: toB64(spkPair.secretKey),
      dhr: null,
      skipped: {},
    })
  }

  serialize(): RatchetState {
    return { ...this.state, skipped: { ...this.state.skipped } }
  }

  static deserialize(s: RatchetState): Ratchet {
    return new Ratchet(s)
  }

  async encrypt(plaintext: Uint8Array, aad?: Uint8Array): Promise<WireMessage> {
    if (!this.state.cks) throw new Error("Ratchet not ready for sending")
    const ck = fromB64(this.state.cks)
    const { mk, next } = await kdfCk(ck)
    this.state.cks = toB64(next)
    const header: RatchetHeader = { dh: this.state.dhPub, pn: this.state.pn, n: this.state.ns }
    this.state.ns++
    const ct = await aeadSeal(mk, plaintext, aad)
    return { h: header, c: toB64(ct) }
  }

  private async trySkipped(dh: string, n: number): Promise<Uint8Array | null> {
    const key = `${dh}:${n}`
    const mkB64 = this.state.skipped[key]
    if (mkB64 === undefined) return null
    delete this.state.skipped[key]
    return fromB64(mkB64)
  }

  private async skipMessageKeys(until: number) {
    if (until - this.state.nr > MAX_SKIP) throw new Error("Too many skipped messages")
    if (this.state.ckr === null) return
    let ck = fromB64(this.state.ckr)
    while (this.state.nr < until) {
      const { mk, next } = await kdfCk(ck)
      this.state.skipped[`${this.state.dhr}:${this.state.nr}`] = toB64(mk)
      ck = next
      this.state.nr++
    }
    this.state.ckr = toB64(ck)
  }

  private async dhRatchet(header: RatchetHeader) {
    this.state.pn = this.state.ns
    this.state.ns = 0
    this.state.nr = 0
    this.state.dhr = header.dh
    const shared1 = nacl.box.before(fromB64(header.dh), fromB64(this.state.dhSec))
    const step1 = await kdfRk(fromB64(this.state.rk), shared1)
    this.state.rk = toB64(step1.rk)
    this.state.ckr = toB64(step1.ck)
    const dhs = nacl.box.keyPair()
    this.state.dhPub = toB64(dhs.publicKey)
    this.state.dhSec = toB64(dhs.secretKey)
    const shared2 = nacl.box.before(fromB64(header.dh), dhs.secretKey)
    const step2 = await kdfRk(step1.rk, shared2)
    this.state.rk = toB64(step2.rk)
    this.state.cks = toB64(step2.ck)
  }

  async decrypt(wire: WireMessage, aad?: Uint8Array): Promise<Uint8Array> {
    if (!wire.h) throw new Error("Missing ratchet header")
    let mk = await this.trySkipped(wire.h.dh, wire.h.n)
    if (mk) return aeadOpen(mk, fromB64(wire.c), aad)
    if (wire.h.dh !== this.state.dhr) {
      await this.skipMessageKeys(wire.h.pn)
      await this.dhRatchet(wire.h)
    }
    await this.skipMessageKeys(wire.h.n)
    if (this.state.ckr === null) throw new Error("Ratchet receive chain not established")
    const ck = fromB64(this.state.ckr)
    const derived = await kdfCk(ck)
    mk = derived.mk
    this.state.ckr = toB64(derived.next)
    this.state.nr++
    return aeadOpen(mk, fromB64(wire.c), aad)
  }
}

// ─── Group / chat epoch keys ────────────────────────────────────────────────

export function newEpochSeed(): Uint8Array {
  return nacl.randomBytes(32)
}

export async function groupMessageKey(epochSeed: Uint8Array, chatId: string, epoch: number): Promise<Uint8Array> {
  return hkdf(epochSeed, utf8(chatId), utf8(`group-epoch:${epoch}`), 32)
}

export async function encryptGroup(
  epochSeed: Uint8Array,
  chatId: string,
  epoch: number,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const key = await groupMessageKey(epochSeed, chatId, epoch)
  const nonce = nacl.randomBytes(12)
  const ct = await aeadSealRaw(key, nonce, plaintext)
  return concat(nonce, ct)
}

export async function decryptGroup(
  epochSeed: Uint8Array,
  chatId: string,
  epoch: number,
  sealed: Uint8Array
): Promise<Uint8Array> {
  const key = await groupMessageKey(epochSeed, chatId, epoch)
  const nonce = sealed.slice(0, 12)
  const ct = sealed.slice(12)
  return aeadOpenRaw(key, nonce, ct)
}

async function aeadSealRaw(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, ["encrypt"])
  return new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, k, plaintext as BufferSource))
}

async function aeadOpenRaw(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, ["decrypt"])
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, k, sealed as BufferSource))
}

// ─── Safety numbers ─────────────────────────────────────────────────────────

export async function safetyNumber(identityKeyA: string, identityKeyB: string): Promise<string> {
  const [a, b] = [identityKeyA, identityKeyB].sort()
  const digest = await sha256(utf8(`${a}:${b}`))
  let digits = ""
  for (const byte of digest) digits += byte.toString().padStart(3, "0")
  const groups: string[] = []
  for (let i = 0; i < 60; i += 5) groups.push(digits.slice(i, i + 5))
  return groups.join(" ")
}

// ─── Encrypted payload envelope format ──────────────────────────────────────

export interface ChatPayload {
  t: "text" | "media" | "file" | "voice" | "location" | "poll" | "call" | "system"
  text?: string
  mediaId?: string
  mediaKey?: string
  fileName?: string
  mime?: string
  size?: number
  width?: number
  height?: number
  durationMs?: number
  waveform?: number[]
  lat?: number
  lng?: number
  live?: boolean
  question?: string
  options?: string[]
  allowMultiple?: boolean
  anonymous?: boolean
  callKind?: "audio" | "video"
  callState?: string
  systemText?: string
}

export async function sealPayload(key: Uint8Array, payload: ChatPayload): Promise<Uint8Array> {
  return aeadSeal(key, utf8(JSON.stringify(payload)))
}

export async function openPayload(key: Uint8Array, sealed: Uint8Array): Promise<ChatPayload> {
  const pt = await aeadOpen(key, sealed)
  return JSON.parse(dec.decode(pt)) as ChatPayload
}
