import * as fs from 'fs';
import { Logger } from 'homebridge';
import { AmplifierState } from '../state/amplifierState';
import { ampVolumeToPercent } from '../state/volumeMapping';
import { IRAmplifierConfig } from '../types';

export const CEC_AUDIO_STATUS_PATH = '/var/lib/homebridge/homebridge-to-cec-audio.json';

export function cecVolumePercent(state: AmplifierState, config: IRAmplifierConfig): number {
  const ampMax = config.volume?.ampMax ?? 100;
  const ampMin = config.volume?.ampMin ?? 0;
  const ampVolume = state.getActualVolume() ?? state.getEstimatedVolume();

  if (ampMax !== 100 || ampMin !== 0) {
    return ampVolumeToPercent(ampVolume, ampMax, ampMin);
  }

  return Math.min(100, Math.max(0, Math.round(ampVolume)));
}

export function writeCecAudioStatus(
  log: Logger,
  state: AmplifierState,
  config: IRAmplifierConfig,
): void {
  try {
    const volume = cecVolumePercent(state, config);
    const mute = state.isMuted() ? 1 : 0;
    const payload = {
      action: 'audio-status',
      volume,
      mute,
      timestamp: Date.now(),
      source: 'homebridge',
    };

    const tempPath = `${CEC_AUDIO_STATUS_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload));
    fs.chmodSync(tempPath, 0o644);
    fs.renameSync(tempPath, CEC_AUDIO_STATUS_PATH);
    log.info(`[CEC] ReportAudioStatus volume=${volume} mute=${mute}`);
  } catch (error) {
    log.error('[CEC] Impossible d\'écrire le statut audio CEC:', error);
  }
}
