// Plays the tunes in `carols.ts` with Web Audio: vibraphone melody, electric
// piano, bass, shaker and rim, optional sleigh bells, through an optional
// "lift speaker" band-pass. Browser only; create it from a click, because
// browsers start audio only after the viewer interacts.

import { arrangeCarol, CAROLS, nextCarolIndex, type ArrangedCarol, type CarolEvent } from "./carols"

export type LessonMusicParts = { sleighBells: boolean; liftSpeaker: boolean }

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const LOOKAHEAD_SECONDS = 0.15

export class LessonMusicEngine {
  private ac: AudioContext
  private master: GainNode
  private volume = 0.6
  private speakerHp: BiquadFilterNode
  private speakerLp: BiquadFilterNode
  private speakerPeak: BiquadFilterNode
  private reverbSend: GainNode
  private noise: AudioBuffer
  private pianoBus: GainNode
  private vibesBus: GainNode
  private arranged: ArrangedCarol[] = CAROLS.map(arrangeCarol)
  private timer: ReturnType<typeof setInterval> | null = null
  private carolIndex = 0
  private anchorTime = 0
  private nextEvent = 0
  private loop = 0
  parts: LessonMusicParts = { sleighBells: false, liftSpeaker: true }
  /** Called when the next tune in the group starts on its own (after two plays). */
  onCarolChange: ((index: number) => void) | null = null

  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ac = new Ctor()
    const ac = this.ac
    this.master = ac.createGain()
    this.master.gain.value = 0
    this.speakerHp = ac.createBiquadFilter()
    this.speakerHp.type = "highpass"
    this.speakerPeak = ac.createBiquadFilter()
    this.speakerPeak.type = "peaking"
    this.speakerPeak.frequency.value = 1600
    this.speakerLp = ac.createBiquadFilter()
    this.speakerLp.type = "lowpass"
    const compressor = ac.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.ratio.value = 3
    this.master.connect(this.speakerHp).connect(this.speakerPeak).connect(this.speakerLp).connect(compressor).connect(ac.destination)
    this.applySpeaker()

    const length = Math.floor(ac.sampleRate * 2.6)
    const impulse = ac.createBuffer(2, length, ac.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3)
    }
    const convolver = ac.createConvolver()
    convolver.buffer = impulse
    this.reverbSend = ac.createGain()
    this.reverbSend.gain.value = 0.32
    this.reverbSend.connect(convolver).connect(this.master)

    this.noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
    const noiseData = this.noise.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1

    this.pianoBus = this.tremoloBus(4.2, 0.22)
    this.vibesBus = this.tremoloBus(5.6, 0.3)
  }

  get playing() {
    return this.timer !== null
  }

  get carol() {
    return CAROLS[this.carolIndex]
  }

  /** The beat of the current carol now playing, for the floor display. */
  currentBeat() {
    return Math.max(0, (this.ac.currentTime - this.anchorTime) / this.secondsPerBeat())
  }

  play(index: number) {
    void this.ac.resume()
    this.startCarol(index, this.ac.currentTime + 0.08)
    this.master.gain.cancelScheduledValues(this.ac.currentTime)
    this.master.gain.setTargetAtTime(this.volume, this.ac.currentTime, 0.03)
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25)
    this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.master.gain.cancelScheduledValues(this.ac.currentTime)
    this.master.gain.setTargetAtTime(0, this.ac.currentTime, 0.08)
  }

  setVolume(volume: number) {
    this.volume = volume
    if (this.playing) this.master.gain.setTargetAtTime(volume, this.ac.currentTime, 0.03)
  }

  setParts(parts: LessonMusicParts) {
    this.parts = parts
    this.applySpeaker()
  }

  close() {
    this.stop()
    setTimeout(() => void this.ac.close(), 500)
  }

  private secondsPerBeat() {
    return 60 / this.carol.bpm
  }

  private startCarol(index: number, when: number) {
    this.carolIndex = index
    this.nextEvent = 0
    this.loop = 0
    this.anchorTime = when
  }

  private tick() {
    const horizon = this.ac.currentTime + LOOKAHEAD_SECONDS
    for (;;) {
      const { events, totalBeats } = this.arranged[this.carolIndex]
      if (this.nextEvent >= events.length) {
        this.loop++
        this.nextEvent = 0
        if (this.loop >= 2) {
          const next = nextCarolIndex(this.carolIndex)
          this.startCarol(next, this.anchorTime + 2 * totalBeats * this.secondsPerBeat())
          this.onCarolChange?.(next)
          continue
        }
      }
      const event = this.arranged[this.carolIndex].events[this.nextEvent]
      const spb = this.secondsPerBeat()
      const at = this.anchorTime + (this.loop * this.arranged[this.carolIndex].totalBeats + event.beat) * spb
      if (at > horizon) break
      if (at > this.ac.currentTime - 0.05) this.playEvent(event, at, spb)
      this.nextEvent++
    }
  }

  private playEvent(e: CarolEvent, t: number, spb: number) {
    switch (e.kind) {
      case "melody": return this.vibes(t, e.note, e.beats * spb)
      case "piano": for (const n of e.chord.tones) this.piano(t + Math.random() * 0.012, n, e.beats * spb, e.velocity); return
      case "bass": return this.bass(t, e.note, e.beats * spb)
      case "shaker": return this.noiseHit(t, "highpass", 6500, 0.7, 0.045 * e.velocity, 0.07)
      case "brush": return this.noiseHit(t, "bandpass", 2800, 0.6, 0.035, 0.35)
      case "rim": return this.rim(t)
      case "sleigh": if (this.parts.sleighBells) this.sleigh(t, e.velocity); return
    }
  }

  private tremoloBus(rate: number, depth: number) {
    const ac = this.ac
    const bus = ac.createGain()
    bus.gain.value = 1 - depth / 2
    const lfo = ac.createOscillator()
    const lfoGain = ac.createGain()
    lfo.frequency.value = rate
    lfoGain.gain.value = depth / 2
    lfo.connect(lfoGain).connect(bus.gain)
    lfo.start()
    const send = ac.createGain()
    send.gain.value = 0.9
    bus.connect(this.master)
    bus.connect(send).connect(this.reverbSend)
    return bus
  }

  private applySpeaker() {
    const t = this.ac.currentTime
    const on = this.parts.liftSpeaker
    this.speakerHp.frequency.setTargetAtTime(on ? 320 : 20, t, 0.05)
    this.speakerLp.frequency.setTargetAtTime(on ? 3400 : 18000, t, 0.05)
    this.speakerPeak.gain.setTargetAtTime(on ? 5 : 0, t, 0.05)
  }

  private envelope(g: GainNode, t: number, peak: number, attack: number, sustain: number, decay: number, end: number, release: number) {
    const held = Math.max(peak * sustain, 0.0001)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(held, t + attack + decay)
    g.gain.setValueAtTime(held, Math.max(end, t + attack + decay))
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(end, t + attack + decay) + release)
  }

  private osc(type: OscillatorType, frequency: number, t: number, stop: number) {
    const o = this.ac.createOscillator()
    o.type = type
    o.frequency.value = frequency
    o.start(t)
    o.stop(stop)
    return o
  }

  private piano(t: number, note: number, dur: number, velocity: number) {
    const ac = this.ac
    const f = mtof(note)
    const end = t + dur
    const amp = ac.createGain()
    this.envelope(amp, t, 0.055 * velocity, 0.006, 0.45, 0.5, end, 0.45)
    const carrier = this.osc("sine", f, t, end + 0.6)
    const modulator = this.osc("sine", f, t, end + 0.6)
    const modGain = ac.createGain()
    modGain.gain.setValueAtTime(f * 1.6 * velocity, t)
    modGain.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.7)
    modulator.connect(modGain).connect(carrier.frequency)
    const tine = this.osc("sine", f * 7.1, t, t + 0.3)
    const tineGain = ac.createGain()
    this.envelope(tineGain, t, 0.012 * velocity, 0.002, 0.01, 0.2, t + 0.22, 0.05)
    const pan = ac.createStereoPanner()
    pan.pan.value = (Math.random() - 0.5) * 0.5
    carrier.connect(amp)
    tine.connect(tineGain).connect(amp)
    amp.connect(pan).connect(this.pianoBus)
  }

  private vibes(t: number, note: number, dur: number) {
    const ac = this.ac
    const f = mtof(note)
    const end = t + Math.max(dur, 0.3)
    const amp = ac.createGain()
    this.envelope(amp, t, 0.16, 0.004, 0.35, Math.max(dur, 0.5), end, 1.2)
    const fundamental = this.osc("sine", f, t, end + 1.4)
    const overtone = this.osc("sine", f * 4, t, t + 0.5)
    const overtoneGain = ac.createGain()
    this.envelope(overtoneGain, t, 0.25, 0.003, 0.01, 0.35, t + 0.38, 0.05)
    fundamental.connect(amp)
    overtone.connect(overtoneGain).connect(amp)
    amp.connect(this.vibesBus)
  }

  private bass(t: number, note: number, dur: number) {
    const ac = this.ac
    const f = mtof(note)
    const end = t + dur
    const lowpass = ac.createBiquadFilter()
    lowpass.type = "lowpass"
    lowpass.frequency.setValueAtTime(900, t)
    lowpass.frequency.exponentialRampToValueAtTime(260, t + 0.3)
    const amp = ac.createGain()
    this.envelope(amp, t, 0.32, 0.012, 0.55, 0.35, end, 0.09)
    this.osc("triangle", f, t, end + 0.15).connect(lowpass)
    this.osc("sine", f, t, end + 0.15).connect(lowpass)
    lowpass.connect(amp).connect(this.master)
  }

  private noiseHit(t: number, type: BiquadFilterType, frequency: number, q: number, peak: number, decay: number) {
    const ac = this.ac
    const source = ac.createBufferSource()
    source.buffer = this.noise
    source.playbackRate.value = 0.8 + Math.random() * 0.4
    const filter = ac.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    source.connect(filter).connect(g).connect(this.master)
    source.start(t, Math.random())
    source.stop(t + decay + 0.02)
  }

  private rim(t: number) {
    const g = this.ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    this.osc("triangle", 1750, t, t + 0.06).connect(g).connect(this.master)
  }

  private sleigh(t: number, velocity: number) {
    for (const offset of [0, 0.011, 0.024]) this.noiseHit(t + offset, "bandpass", 7600, 3, 0.05 * velocity, 0.09)
    for (const f of [5200, 6900, 8300]) {
      const g = this.ac.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.008 * velocity, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      this.osc("sine", f * (1 + (Math.random() - 0.5) * 0.02), t, t + 0.2).connect(g).connect(this.master)
    }
  }
}
