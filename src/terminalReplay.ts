/**
 * terminalReplay.ts — a terminal tab opening while its session prints: the
 * output so far (the replay) and the live batches meet without doubling or
 * dropping anything. Each batch carries a number (electron/terminals.cjs);
 * the replay says the last number it holds. A batch arriving before the
 * replay is held, then written only when it is newer than the replay.
 */

export interface ReplayGate {
  /** A live batch */
  live(data: string, seq: number): void
  /** The replay arrived (data may be empty) */
  replay(data: string, seq: number): void
  /** No replay to be had: write what was held and go live */
  fail(): void
}

export function createReplayGate(write: (data: string) => void): ReplayGate {
  let replayed: number | null = null
  const held: { data: string; seq: number }[] = []
  const goLive = (seq: number) => {
    replayed = seq
    for (const h of held.splice(0)) if (h.seq > seq) write(h.data)
  }
  return {
    live(data, seq) {
      if (replayed === null) held.push({ data, seq })
      else if (seq > replayed) write(data)
    },
    replay(data, seq) {
      if (replayed !== null) return
      if (data) write(data)
      goLive(seq)
    },
    fail() { if (replayed === null) goLive(0) },
  }
}
