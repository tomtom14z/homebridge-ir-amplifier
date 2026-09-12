import { EventEmitter } from 'events';
import { Logger } from 'homebridge';
import {
  AmplifierStateSnapshot,
  AudioFormat,
  AudioMode,
  PowerState,
} from '../types';

export class AmplifierState extends EventEmitter {
  private power: PowerState = 'unknown';
  private requestedVolume?: number;
  private estimatedVolume?: number;
  private actualVolume?: number;
  private lastConfirmedVolume?: number;
  private volumeConfidence?: number;
  private muted = false;
  private requestedMode?: AudioMode;
  private actualMode?: AudioMode;
  private inputFormat?: AudioFormat;
  private displayState?: string;
  private lastIrCommand?: string;
  private lastCecCommand?: string;
  private lastCameraRead?: Date;
  private lastConfirmedVolumeAt?: Date;
  private lastConfirmedModeAt?: Date;

  constructor(private readonly log: Logger) {
    super();
  }

  snapshot(): AmplifierStateSnapshot {
    return {
      power: this.power,
      requestedVolume: this.requestedVolume,
      estimatedVolume: this.estimatedVolume,
      actualVolume: this.actualVolume,
      lastConfirmedVolume: this.lastConfirmedVolume,
      volumeConfidence: this.volumeConfidence,
      muted: this.muted,
      requestedMode: this.requestedMode,
      actualMode: this.actualMode,
      inputFormat: this.inputFormat,
      displayState: this.displayState,
      lastIrCommand: this.lastIrCommand,
      lastCecCommand: this.lastCecCommand,
      lastCameraRead: this.lastCameraRead,
      lastConfirmedVolumeAt: this.lastConfirmedVolumeAt,
      lastConfirmedModeAt: this.lastConfirmedModeAt,
    };
  }

  isOn(): boolean {
    return this.power === 'on';
  }

  getPower(): PowerState {
    return this.power;
  }

  setPower(power: PowerState, source: string): void {
    if (this.power === power) {
      return;
    }
    this.log.info(`[STATE] Power ${this.power} -> ${power} (${source})`);
    this.power = power;
    this.emitChange();
  }

  setPowerOn(on: boolean, source: string): void {
    this.setPower(on ? 'on' : 'off', source);
  }

  getEstimatedVolume(): number {
    return this.estimatedVolume ?? 50;
  }

  setEstimatedVolume(value: number, reason?: string): void {
    const next = this.clampVolume(value);
    if (this.estimatedVolume === next) {
      return;
    }
    const from = this.estimatedVolume;
    this.estimatedVolume = next;
    this.log.info(
      `[STATE] Estimated volume ${from ?? 'unknown'} -> ${next}${reason ? ` (${reason})` : ''}`,
    );
    this.emitChange();
  }

  adjustEstimatedVolume(delta: number): number {
    const next = this.clampVolume(this.getEstimatedVolume() + delta);
    this.setEstimatedVolume(next, delta > 0 ? 'volume up' : 'volume down');
    return next;
  }

  getRequestedVolume(): number {
    return this.requestedVolume ?? this.getEstimatedVolume();
  }

  setRequestedVolume(value: number): void {
    const next = this.clampVolume(value);
    this.requestedVolume = next;
    this.emitChange();
  }

  getActualVolume(): number | undefined {
    return this.actualVolume;
  }

  confirmVolume(value: number, confidence: number): void {
    const next = this.clampVolume(value);
    this.actualVolume = next;
    this.lastConfirmedVolume = next;
    this.volumeConfidence = confidence;
    this.lastConfirmedVolumeAt = new Date();
    this.estimatedVolume = next;
    this.log.info(`[STATE] Volume confirmed ${next} (confidence=${confidence})`);
    this.emitChange();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) {
      return;
    }
    this.muted = muted;
    this.log.info(`[STATE] Mute -> ${muted}`);
    this.emitChange();
  }

  setRequestedMode(mode: AudioMode): void {
    this.requestedMode = mode;
    this.emitChange();
  }

  confirmMode(mode: AudioMode): void {
    this.actualMode = mode;
    this.lastConfirmedModeAt = new Date();
    this.log.info(`[STATE] Mode confirmed ${mode}`);
    this.emitChange();
  }

  setInputFormat(format: AudioFormat): void {
    this.inputFormat = format;
    this.emitChange();
  }

  setDisplayState(displayState: string): void {
    this.displayState = displayState;
    this.emitChange();
  }

  setLastIrCommand(command: string): void {
    this.lastIrCommand = command;
    this.emitChange();
  }

  setLastCecCommand(command: string): void {
    this.lastCecCommand = command;
    this.emitChange();
  }

  markCameraRead(): void {
    this.lastCameraRead = new Date();
    this.emitChange();
  }

  private clampVolume(value: number): number {
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  private emitChange(): void {
    this.emit('change', this.snapshot());
  }
}
