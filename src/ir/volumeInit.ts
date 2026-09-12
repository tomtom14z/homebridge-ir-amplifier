import { Logger } from 'homebridge';
import { IRAmplifierConfig } from '../types';
import { IrBackend } from './irBackend';

export function getStartupVolume(config: IRAmplifierConfig): number {
  return config.volumeInit?.startupVolume ?? 20;
}

export function isVolumeInitEnabled(config: IRAmplifierConfig): boolean {
  return Boolean(config.volumeInit?.enabled);
}

export async function initializeVolume(
  ir: IrBackend,
  config: IRAmplifierConfig,
  log: Logger,
): Promise<boolean> {
  if (!config.volumeInit?.enabled) {
    log.info('Volume initialization is disabled');
    return true;
  }

  const { maxVolumeSteps, startupVolume, delayBetweenSteps } = config.volumeInit;
  log.info(
    `Volume initialization starting: maxSteps=${maxVolumeSteps}, startupVolume=${startupVolume}, delay=${delayBetweenSteps}ms`,
  );

  try {
    log.info(`Sending ${maxVolumeSteps} volume down commands to reach minimum volume...`);
    for (let i = 0; i < maxVolumeSteps; i++) {
      const success = await ir.send('volumeDown');
      if (!success) {
        log.error(`Failed to send volume down command ${i + 1}/${maxVolumeSteps}`);
        return false;
      }
      if (i < maxVolumeSteps - 1) {
        await delay(delayBetweenSteps);
      }
    }

    log.info('Volume set to minimum, waiting 1 second before setting startup volume...');
    await delay(1000);

    const volumeUpSteps = Math.min(startupVolume, maxVolumeSteps);
    log.info(`Sending ${volumeUpSteps} volume up commands to reach startup volume ${startupVolume}...`);

    for (let i = 0; i < volumeUpSteps; i++) {
      const success = await ir.send('volumeUp');
      if (!success) {
        log.error(`Failed to send volume up command ${i + 1}/${volumeUpSteps}`);
        return false;
      }
      if (i < volumeUpSteps - 1) {
        await delay(delayBetweenSteps);
      }
    }

    log.info(`Volume initialization completed successfully - volume set to ${startupVolume}`);
    return true;
  } catch (error) {
    log.error('Volume initialization failed:', error);
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
