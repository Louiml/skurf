declare module "tweetnacl" {
  export interface BoxKeyPair {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }
  export interface SignKeyPair {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }
  export interface BoxKeyPairFn {
    (): BoxKeyPair
    fromSecretKey(secretKey: Uint8Array): BoxKeyPair
  }
  export interface SignDetachedFn {
    (message: Uint8Array, secretKey: Uint8Array): Uint8Array
    verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean
  }
  const nacl: {
    randomBytes(n: number): Uint8Array
    box: {
      keyPair: BoxKeyPairFn
      before(theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array
    }
    sign: {
      keyPair(): SignKeyPair
      detached: SignDetachedFn
    }
    scalarMult: {
      base(n: Uint8Array): Uint8Array
    }
  }
  export default nacl
}

declare module "jsqr" {
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: string }
  ): { data: string } | null
}
