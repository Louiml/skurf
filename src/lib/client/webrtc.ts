"use client"

import { getSocket } from "./socket"
import { GET } from "./api"

export interface RemoteParticipant {
  userId: string
  stream?: MediaStream
  speaking: boolean
}

type Listener = () => void

export class CallManager {
  callId: string | null = null
  chatId: string | null = null
  kind: "AUDIO" | "VIDEO" = "AUDIO"
  localStream: MediaStream | null = null
  screenStream: MediaStream | null = null
  muted = false
  cameraOff = false
  peers = new Map<string, RTCPeerConnection>()
  remoteStreams = new Map<string, MediaStream>()
  speaking = new Map<string, boolean>()
  state: "idle" | "outgoing" | "incoming" | "active" | "ended" = "idle"
  fromName = ""
  private listeners = new Set<Listener>()
  private iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private pendingOffer = new Map<string, RTCSessionDescriptionInit>()

  constructor() {
    if (typeof window !== "undefined") this.bind()
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private bind() {
    const socket = getSocket()
    if (!socket) return
    socket.on("webrtc:signal", (data) => void this.onSignal(data as any))
    socket.on("call:ring", (data) => {
      this.callId = data.callId
      this.chatId = data.chatId
      this.kind = data.kind
      this.fromName = data.fromName
      this.state = "incoming"
      this.emit()
    })
    socket.on("call:accepted", () => {
      if (this.state === "outgoing" || this.state === "active") {
        this.state = "active"
        this.emit()
      }
    })
    socket.on("call:ended", () => this.cleanup())
    socket.on("call:declined", () => {
      if (this.state === "outgoing") this.cleanup()
    })
    socket.on("call:participants", (data) => {
      if (this.callId === data.callId && this.state === "active") {
        for (const userId of data.participants) {
          if (userId !== this.myId() && !this.peers.has(userId)) {
            void this.createOffer(userId)
          }
        }
      }
    })
  }

  myId(): string | null {
    return localStorage.getItem("skurf:userId")
  }

  async start(chatId: string, kind: "AUDIO" | "VIDEO") {
    const socket = getSocket()
    if (!socket) return
    try {
      const cfg = await GET<{ iceServers: RTCIceServer[] }>("/api/turn")
      this.iceServers = cfg.iceServers
    } catch {}
    await this.setupLocal(kind)
    this.kind = kind
    this.chatId = chatId
    this.state = "outgoing"
    this.emit()
    socket.emit("call:ring", { chatId, kind }, (res: any) => {
      if (res?.ok && res.callId) {
        this.callId = res.callId
        this.emit()
      } else {
        this.cleanup()
      }
    })
  }

  async accept() {
    if (!this.callId) return
    const socket = getSocket()
    try {
      const cfg = await GET<{ iceServers: RTCIceServer[] }>("/api/turn")
      this.iceServers = cfg.iceServers
    } catch {}
    await this.setupLocal(this.kind)
    socket?.emit("call:accept", { callId: this.callId })
    this.state = "active"
    this.emit()
  }

  decline() {
    if (this.callId) getSocket()?.emit("call:decline", { callId: this.callId })
    this.cleanup()
  }

  end() {
    if (this.callId) getSocket()?.emit("call:end", { callId: this.callId })
    this.cleanup()
  }

  private async setupLocal(kind: "AUDIO" | "VIDEO") {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "VIDEO" ? { width: 1280, height: 720 } : false,
    })
    this.cameraOff = kind !== "VIDEO"
    this.trackSpeaking()
  }

  private trackSpeaking() {
    if (!this.localStream) return
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(this.localStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let last = false
    const tick = () => {
      if (!this.localStream) return
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += (v - 128) * (v - 128)
      const speaking = Math.sqrt(sum / data.length) / 128 > 0.06
      if (speaking !== last) {
        last = speaking
        this.speaking.set("me", speaking)
        this.emit()
      }
      requestAnimationFrame(tick)
    }
    tick()
  }

  toggleMute() {
    this.muted = !this.muted
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.muted))
    this.emit()
  }

  toggleCamera() {
    this.cameraOff = !this.cameraOff
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !this.cameraOff))
    this.emit()
  }

  async toggleScreenShare() {
    const socket = getSocket()
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
      this.emit()
      return
    }
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
    this.screenStream.getVideoTracks()[0].onended = () => {
      this.screenStream = null
      this.emit()
    }
    for (const [userId] of this.peers) {
      const sender = this.peers.get(userId)?.getSenders().find((s) => s.track?.kind === "video")
      if (sender) await sender.replaceTrack(this.screenStream!.getVideoTracks()[0])
    }
    this.emit()
  }

  private async createPeer(userId: string): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.peers.set(userId, pc)
    this.remoteStreams.set(userId, new MediaStream())
    this.localStream?.getTracks().forEach((track) => {
      if (track.kind === "video" && this.kind !== "VIDEO" && !this.screenStream) return
      pc.addTrack(track, this.screenStream ?? this.localStream!)
    })
    pc.onicecandidate = (e) => {
      if (e.candidate && this.callId) {
        getSocket()?.emit("webrtc:signal", { callId: this.callId, toUserId: userId, signal: { type: "ice", candidate: e.candidate.toJSON() } })
      }
    }
    pc.ontrack = (e) => {
      const stream = this.remoteStreams.get(userId)
      stream?.addTrack(e.track)
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.peers.delete(userId)
        this.remoteStreams.delete(userId)
        this.emit()
      }
    }
    return pc
  }

  private async createOffer(userId: string) {
    const pc = await this.createPeer(userId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    if (this.callId) {
      getSocket()?.emit("webrtc:signal", { callId: this.callId, toUserId: userId, signal: { type: "offer", sdp: offer.sdp } })
    }
  }

  private deviceOf = new Map<string, string>()

  setParticipantDevice(userId: string, deviceId: string) {
    this.deviceOf.set(userId, deviceId)
  }

  private async onSignal(data: { callId: string; fromUserId: string; fromDevice: string; signal: { type: string; sdp?: string; candidate?: RTCIceCandidateInit } }) {
    if (this.callId && data.callId !== this.callId) return
    this.deviceOf.set(data.fromUserId, data.fromDevice)
    const userId = data.fromUserId
    let pc = this.peers.get(userId)
    const sig = data.signal
    if (sig.type === "offer") {
      if (!pc) pc = await this.createPeer(userId)
      await pc.setRemoteDescription({ type: "offer", sdp: sig.sdp })
      const pending = this.pendingCandidates.get(userId) ?? []
      for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      this.pendingCandidates.delete(userId)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      if (this.callId) {
        getSocket()?.emit("webrtc:signal", { callId: this.callId, toUserId: userId, signal: { type: "answer", sdp: answer.sdp } })
      }
      if (this.state === "incoming") {
        this.state = "active"
        this.emit()
      }
    } else if (sig.type === "answer" && pc) {
      await pc.setRemoteDescription({ type: "answer", sdp: sig.sdp }).catch(() => {})
      const pending = this.pendingCandidates.get(userId) ?? []
      for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      this.pendingCandidates.delete(userId)
    } else if (sig.type === "ice" && sig.candidate) {
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {})
      } else {
        const list = this.pendingCandidates.get(userId) ?? []
        list.push(sig.candidate)
        this.pendingCandidates.set(userId, list)
      }
    }
  }

  private cleanup() {
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.screenStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    this.screenStream = null
    for (const pc of this.peers.values()) pc.close()
    this.peers.clear()
    this.remoteStreams.clear()
    this.speaking.clear()
    this.callId = null
    this.chatId = null
    this.state = "idle"
    this.emit()
  }
}

export const callManager = new CallManager()
