/**
 * sounds.ts — short notification sounds, drawn here with the Web Audio API
 * (no sound files: nothing borrowed, nothing to download). Each is a few soft
 * notes: a catch rings up, an escape slides down, a level-up climbs quickly,
 * an evolution climbs further; a rare catch adds a note, a shiny a sparkle.
 * Played by the notification window as a card appears (설정 › 알림 › 효과음).
 */

import type { DexEvent } from './pokedexStore'

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

/** One note: a soft attack, a short ring-out */
function note(ac: AudioContext, freq: number, at: number, length: number, { type = 'triangle' as OscillatorType, gain = 0.07 } = {}) {
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(amp).connect(ac.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

/** A note gliding from one pitch to another (the escape) */
function glide(ac: AudioContext, from: number, to: number, at: number, length: number, gain = 0.05) {
  const osc = ac.createOscillator()
  const amp = ac.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + length)
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.015)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(amp).connect(ac.destination)
  osc.start(at)
  osc.stop(at + length + 0.02)
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 }
const RARE = new Set(['rare', 'sub', 'legendary', 'mythical'])
const LEGEND = new Set(['legendary', 'mythical'])

/** The sound for a notification card, if its kind has one */
export function playFor(e: DexEvent): void {
  const kind = e.kind
  if (kind !== 'catch' && kind !== 'flee' && kind !== 'levelup' && kind !== 'evolve') return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.02
  if (kind === 'catch') {
    note(ac, N.E5, t, 0.16)
    note(ac, N.B5, t + 0.09, 0.28)
    if (RARE.has(e.tier ?? '')) note(ac, N.E6, t + 0.19, 0.34)
    if (LEGEND.has(e.tier ?? '')) note(ac, N.G6, t + 0.3, 0.5, { gain: 0.06 })
  } else if (kind === 'flee') {
    glide(ac, N.G5, N.C5 * 0.75, t, 0.32)
  } else if (kind === 'levelup') {
    ;[N.C6, N.E6, N.G6].forEach((f, i) => note(ac, f, t + i * 0.06, 0.14, { type: 'square', gain: 0.025 }))
  } else {
    ;[N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => note(ac, f, t + i * 0.09, 0.3, { gain: 0.06 }))
  }
  // A shiny one sparkles
  if (e.shiny && kind !== 'flee') [N.C7, N.G6 * 1.5, N.C7 * 1.2].forEach((f, i) => note(ac, f, t + 0.36 + i * 0.05, 0.12, { type: 'sine', gain: 0.025 }))
}
