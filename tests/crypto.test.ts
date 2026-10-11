import { describe, it, expect } from "vitest"
import nacl from "tweetnacl"
import {
  x3dhInitiator,
  x3dhResponder,
  Ratchet,
  encryptGroup,
  decryptGroup,
  safetyNumber,
  aeadSeal,
  aeadOpen,
  hkdf,
  toB64,
  fromB64,
  utf8,
  type WireMessage,
} from "../src/lib/crypto/protocol"

function makeBundle(opk?: nacl.BoxKeyPair) {
  const identity = nacl.box.keyPair()
  const signing = nacl.sign.keyPair()
  const spk = nacl.box.keyPair()
  const sig = nacl.sign.detached(spk.publicKey, signing.secretKey)
  return {
    identity,
    signing,
    spk,
    sig,
    bundle: {
      identityKey: toB64(identity.publicKey),
      signingKey: toB64(signing.publicKey),
      signedPreKeyId: 1,
      signedPreKey: toB64(spk.publicKey),
      signedPreKeySig: toB64(sig),
      oneTimePreKeyId: opk ? 7 : undefined,
      oneTimePreKey: opk ? toB64(opk.publicKey) : undefined,
    },
  }
}

describe("AEAD", () => {
  it("round-trips", async () => {
    const key = nacl.randomBytes(32)
    const pt = utf8("hello skurf")
    const sealed = await aeadSeal(key, pt)
    const opened = await aeadOpen(key, sealed)
    expect(new TextDecoder().decode(opened)).toBe("hello skurf")
  })

  it("rejects wrong key", async () => {
    const key = nacl.randomBytes(32)
    const sealed = await aeadSeal(key, utf8("secret"))
    await expect(aeadOpen(nacl.randomBytes(32), sealed)).rejects.toThrow()
  })

  it("rejects tampered ciphertext", async () => {
    const key = nacl.randomBytes(32)
    const sealed = await aeadSeal(key, utf8("secret"))
    sealed[sealed.length - 1] ^= 1
    await expect(aeadOpen(key, sealed)).rejects.toThrow()
  })
})

describe("HKDF", () => {
  it("is deterministic and length-correct", async () => {
    const out1 = await hkdf(utf8("ikm"), utf8("salt"), utf8("info"), 64)
    const out2 = await hkdf(utf8("ikm"), utf8("salt"), utf8("info"), 64)
    expect(out1).toEqual(out2)
    expect(out1.length).toBe(64)
  })
})

describe("X3DH", () => {
  it("derives the same shared secret on both sides (with one-time prekey)", async () => {
    const aliceIdentity = nacl.box.keyPair()
    const opk = nacl.box.keyPair()
    const bob = makeBundle(opk)
    const { sk: skA, preKeyMsg } = await x3dhInitiator(aliceIdentity, bob.bundle)
    const skB = await x3dhResponder(bob.identity, bob.spk, opk, preKeyMsg)
    expect(toB64(skA)).toBe(toB64(skB))
  })

  it("works without a one-time prekey", async () => {
    const aliceIdentity = nacl.box.keyPair()
    const bob = makeBundle()
    const { sk: skA, preKeyMsg } = await x3dhInitiator(aliceIdentity, bob.bundle)
    const skB = await x3dhResponder(bob.identity, bob.spk, null, preKeyMsg)
    expect(toB64(skA)).toBe(toB64(skB))
  })

  it("rejects a bundle with a bad signed-prekey signature", async () => {
    const aliceIdentity = nacl.box.keyPair()
    const bob = makeBundle()
    const bad = { ...bob.bundle, signedPreKeySig: toB64(nacl.randomBytes(64)) }
    await expect(x3dhInitiator(aliceIdentity, bad)).rejects.toThrow("signature invalid")
  })
})

describe("Double Ratchet", () => {
  it("establishes a session and round-trips in both directions", async () => {
    const bobSpk = nacl.box.keyPair()
    const { sk, preKeyMsg } = await x3dhInitiator(nacl.box.keyPair(), makeBundle(bobSpk).bundle)
    const alice = await Ratchet.initAsInitiator(sk, bobSpk.publicKey)
    const bob = await Ratchet.initAsResponder(sk, bobSpk)

    const m1: WireMessage = await alice.encrypt(utf8("hi bob"))
    m1.pk = preKeyMsg
    expect(new TextDecoder().decode(await bob.decrypt(m1))).toBe("hi bob")

    const m2 = await bob.encrypt(utf8("hi alice"))
    expect(new TextDecoder().decode(await alice.decrypt(m2))).toBe("hi alice")

    const m3 = await alice.encrypt(utf8("again"))
    expect(new TextDecoder().decode(await bob.decrypt(m3))).toBe("again")
  })

  it("survives out-of-order delivery", async () => {
    const bobSpk = nacl.box.keyPair()
    const { sk } = await x3dhInitiator(nacl.box.keyPair(), makeBundle(bobSpk).bundle)
    const alice = await Ratchet.initAsInitiator(sk, bobSpk.publicKey)
    const bob = await Ratchet.initAsResponder(sk, bobSpk)

    const m1 = await alice.encrypt(utf8("first"))
    const m2 = await alice.encrypt(utf8("second"))
    expect(new TextDecoder().decode(await bob.decrypt(m2))).toBe("second")
    expect(new TextDecoder().decode(await bob.decrypt(m1))).toBe("first")
  })

  it("handles many alternating turns", async () => {
    const bobSpk = nacl.box.keyPair()
    const { sk } = await x3dhInitiator(nacl.box.keyPair(), makeBundle(bobSpk).bundle)
    const alice = await Ratchet.initAsInitiator(sk, bobSpk.publicKey)
    const bob = await Ratchet.initAsResponder(sk, bobSpk)

    for (let i = 0; i < 20; i++) {
      const fromAlice = await alice.encrypt(utf8(`a${i}`))
      expect(new TextDecoder().decode(await bob.decrypt(fromAlice))).toBe(`a${i}`)
      const fromBob = await bob.encrypt(utf8(`b${i}`))
      expect(new TextDecoder().decode(await alice.decrypt(fromBob))).toBe(`b${i}`)
    }
  })

  it("restores state from serialization", async () => {
    const bobSpk = nacl.box.keyPair()
    const { sk } = await x3dhInitiator(nacl.box.keyPair(), makeBundle(bobSpk).bundle)
    const alice = Ratchet.deserialize((await Ratchet.initAsInitiator(sk, bobSpk.publicKey)).serialize())
    const bob = Ratchet.deserialize((await Ratchet.initAsResponder(sk, bobSpk)).serialize())
    const m = await alice.encrypt(utf8("after reload"))
    expect(new TextDecoder().decode(await bob.decrypt(m))).toBe("after reload")
  })
})

describe("Group epoch encryption", () => {
  it("round-trips for any holder of the epoch seed", async () => {
    const seed = nacl.randomBytes(32)
    const sealed = await encryptGroup(seed, "chat123", 0, utf8("group secret"))
    const opened = await decryptGroup(seed, "chat123", 0, sealed)
    expect(new TextDecoder().decode(opened)).toBe("group secret")
  })

  it("different epoch seeds cannot read each other", async () => {
    const seed = nacl.randomBytes(32)
    const sealed = await encryptGroup(seed, "chat123", 0, utf8("group secret"))
    await expect(decryptGroup(nacl.randomBytes(32), "chat123", 0, sealed)).rejects.toThrow()
  })

  it("epoch rotation blocks old members", async () => {
    const seed0 = nacl.randomBytes(32)
    const seed1 = nacl.randomBytes(32)
    const m0 = await encryptGroup(seed0, "chat", 0, utf8("old"))
    const m1 = await encryptGroup(seed1, "chat", 1, utf8("new"))
    expect(new TextDecoder().decode(await decryptGroup(seed1, "chat", 1, m1))).toBe("new")
    expect(new TextDecoder().decode(await decryptGroup(seed0, "chat", 0, m0))).toBe("old")
    await expect(decryptGroup(seed0, "chat", 1, m1)).rejects.toThrow()
  })
})

describe("Safety number", () => {
  it("is symmetric and stable", async () => {
    const a = toB64(nacl.box.keyPair().publicKey)
    const b = toB64(nacl.box.keyPair().publicKey)
    const ab = await safetyNumber(a, b)
    const ba = await safetyNumber(b, a)
    expect(ab).toBe(ba)
    expect(ab).toMatch(/^\d{5}( \d{5}){11}$/)
  })

  it("differs for different identities", async () => {
    const a = toB64(nacl.box.keyPair().publicKey)
    const b = toB64(nacl.box.keyPair().publicKey)
    const c = toB64(nacl.box.keyPair().publicKey)
    expect(await safetyNumber(a, b)).not.toBe(await safetyNumber(a, c))
  })
})
