/** Fresh headless state. Times are AudioContext seconds, not wall-clock timestamps. */
export interface PlayStatus {
  state: "loading" | "stopped" | "starting" | "playing" | "paused" | "failed";
  tick: number | null;
  maxTick: number | null;
  /** Engine scheduler time; a pass may be scheduled ahead of audibility and is heard at startTime + latencySeconds. */
  startTime: number | null;
  /** First scheduled tick-zero origin; unchanged across pause and passes. */
  originTime: number | null;
  audioTime: number | null;
  passSeconds: number | null;
  /** Raw component (finite and in [0, 1] s, otherwise 0); informational. Offset times by latencySeconds. */
  outputLatency: number;
  /** Raw component (finite and in [0, 1] s, otherwise 0); informational. Offset times by latencySeconds. */
  baseLatency: number;
  /** Shared validated outputLatency + baseLatency estimate, refreshed at 250 ms / 2 ms. */
  latencySeconds: number;
  /** Increments on each play start and each accepted latency update. */
  latencyRevision: number;
  audioState: string | null;
  /** Estimated total audible seconds since tick zero; holds while the context is suspended. */
  positionSeconds: number | null;
  runId: number;
  error: Error | null;
}
/**
 * A pass boundary, delivered once the audio clock reaches audibleTime (at once when it is null). Use audibleTime
 * (startTime + latencySeconds) as the time the pass is heard: startTime + outputLatency is early by baseLatency.
 */
export interface PassStart {
  runId: number;
  passIndex: number;
  initial: boolean;
  /** Null, with audibleTime, only on the one initial event of a run whose engine reported no finite start time. */
  startTime: number | null;
  /** startTime + latencySeconds: when this pass is heard. */
  audibleTime: number | null;
  audioTime: number | null;
  /** Raw component read at dispatch (finite and in [0, 1] s, otherwise 0); informational, not the offset to apply. */
  outputLatency: number;
  /** Raw component read at dispatch (finite and in [0, 1] s, otherwise 0); informational, not the offset to apply. */
  baseLatency: number;
  /** Shared validated outputLatency + baseLatency estimate, refreshed at 250 ms / 2 ms. */
  latencySeconds: number;
}
export interface OnchainMidiApi {
  ready: Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): void;
  getPlayStatus(): PlayStatus;
  onPassStart(callback: (event: PassStart) => void): () => void;
  /**
   * Receives a fresh status on each state change and on each accepted latency update (a change of at least
   * 2 ms, polled every 250 ms while playing or paused and checked when a resume completes), so consecutive
   * snapshots can repeat a state such as "playing". Compare state, runId and latencyRevision.
   */
  onStateChange(callback: (status: PlayStatus) => void): () => void;
}
declare global {
  interface Window {
    OnchainLibraries: { ready: Promise<void> };
    OnchainMidiPlayer: OnchainMidiApi;
    WebAudioTinySynth: new (...args: any[]) => any;
  }
}
