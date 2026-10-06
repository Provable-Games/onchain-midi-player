/** Fresh headless state. Times are AudioContext seconds, not wall-clock timestamps. */
export interface PlayStatus {
  state: "loading" | "stopped" | "starting" | "playing" | "failed";
  tick: number | null;
  maxTick: number | null;
  /** Engine scheduler time; a pass may be scheduled ahead of audibility. */
  startTime: number | null;
  audioTime: number | null;
  passSeconds: number | null;
  outputLatency: number;
  runId: number;
  error: Error | null;
}
export interface PassStart {
  runId: number;
  passIndex: number;
  initial: boolean;
  startTime: number | null;
  audibleTime: number | null;
  audioTime: number | null;
  outputLatency: number;
}
export interface OnchainMidiApi {
  ready: Promise<void>;
  play(): Promise<void>;
  stop(): void;
  getPlayStatus(): PlayStatus;
  onPassStart(callback: (event: PassStart) => void): () => void;
  onStateChange(callback: (status: PlayStatus) => void): () => void;
}
declare global {
  interface Window {
    OnchainLibraries: { ready: Promise<void> };
    OnchainMidiPlayer: OnchainMidiApi;
    WebAudioTinySynth: new (...args: any[]) => any;
  }
}
