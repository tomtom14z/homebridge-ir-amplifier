import { Logger } from 'homebridge';
import { BroadlinkController } from '../broadlinkController';
import { IRAmplifierConfig } from '../types';
import { AutoIrBackend } from './autoIrBackend';
import { GpioIrBackend } from './gpioIrBackend';
import { IrBackend } from './irBackend';

export function createIrBackend(log: Logger, config: IRAmplifierConfig): IrBackend {
  const requested = config.irBackend ?? 'broadlink';

  if (requested === 'gpio') {
    log.info('[IR] Mode GPIO local — mêmes trames hex que Broadlink');
    return new GpioIrBackend(log, config);
  }

  const broadlink = new BroadlinkController(log, config);

  if (requested === 'auto') {
    log.info('[IR] Mode auto — GPIO local puis Broadlink en secours');
    return new AutoIrBackend(log, new GpioIrBackend(log, config), broadlink);
  }

  log.info('[IR] Backend: broadlink');
  return broadlink;
}
