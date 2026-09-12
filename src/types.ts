export type IrBackendName = 'broadlink' | 'gpio' | 'auto';

export interface IrCommandsConfig {
  power: string;
  powerOn?: string;
  powerOff?: string;
  source: string;
  volumeUp: string;
  volumeDown: string;
  mute?: string;
  menu?: string;
  up?: string;
  down?: string;
  left?: string;
  right?: string;
  enter?: string;
}

export interface GpioIrConfig {
  device?: string;
  carrierHz?: number;
}

export interface IRAmplifierConfig {
  irBackend?: IrBackendName;
  irCommands?: IrCommandsConfig;
  gpio?: GpioIrConfig;
  broadlink?: {
    host?: string;
    mac?: string;
    commands?: IrCommandsConfig;
  };
  volumeInit?: {
    enabled: boolean;
    maxVolumeSteps: number;
    startupVolume: number;
    delayBetweenSteps: number;
  };
  volume?: {
    ampMin?: number;
    ampMax?: number;
  };
  powerOnEnhancements?: {
    autoHDMI1: boolean;
    tplinkPowerCheck: boolean;
    tplinkPowerOnDelay: number;
    disableAutoPowerOn?: boolean;
  };
  tplink: {
    host: string;
  };
  ocr?: {
    enabled?: boolean;
    cameraUrl?: string;
    checkInterval?: number;
  };
}

export type PowerState = 'off' | 'standby' | 'on' | 'unknown';

export type AudioMode =
  | 'STEREO'
  | 'NATURAL_SURROUND'
  | 'PLII_MUSIC'
  | 'PLII_MOVIE'
  | 'DOLBY_DIGITAL'
  | 'DTS'
  | 'PCM'
  | 'AUTO_MOVIE'
  | string;

export type AudioFormat =
  | 'PCM_2_0'
  | 'DOLBY_DIGITAL'
  | 'DTS'
  | 'UNKNOWN'
  | string;

export interface AmplifierStateSnapshot {
  power: PowerState;
  requestedVolume?: number;
  estimatedVolume?: number;
  actualVolume?: number;
  lastConfirmedVolume?: number;
  volumeConfidence?: number;
  muted?: boolean;
  requestedMode?: AudioMode;
  actualMode?: AudioMode;
  inputFormat?: AudioFormat;
  displayState?: string;
  lastIrCommand?: string;
  lastCecCommand?: string;
  lastCameraRead?: Date;
  lastConfirmedVolumeAt?: Date;
  lastConfirmedModeAt?: Date;
}
