"use client"

import { db } from "./dexie"
import nacl from "tweetnacl"
import { toB64, fromB64, utf8 } from "@/lib/crypto/protocol"

const PBKDF2_ITERATIONS = 310_000

async function deriveWrapKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(passcode) as BufferSource, "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function hasPasscode(): Promise<boolean> {
  return (await db.passcode.get("main")) !== undefined
}

export async function setPasscode(passcode: string): Promise<boolean> {
  const keys = await db.deviceKeys.toArray()
  if (keys.length === 0) return false
  const salt = nacl.randomBytes(16)
  const iv = nacl.randomBytes(12)
  const key = await deriveWrapKey(passcode, salt)
  const bundle: Record<string, string> = {}
  for (const k of keys) {
    bundle[k.deviceId] = JSON.stringify({ identitySecret: k.identitySecret, signingSecret: k.signingSecret, spkSecret: k.spkSecret })
  }
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, utf8(JSON.stringify(bundle)) as BufferSource)
  await db.passcode.put({ key: "main", salt: toB64(salt), iv: toB64(iv), wrapped: toB64(new Uint8Array(ct)) })
  return true
}

export async function clearPasscode() {
  await db.passcode.delete("main")
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const row = await db.passcode.get("main")
  if (!row) return true
  try {
    const key = await deriveWrapKey(passcode, fromB64(row.salt))
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(row.iv) as BufferSource },
      key,
      fromB64(row.wrapped) as BufferSource
    )
    return new TextDecoder().decode(pt).length > 0
  } catch {
    return false
  }
}
