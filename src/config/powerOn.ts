import { IRAmplifierConfig } from '../types';

export function isAutoHDMI1Enabled(config: IRAmplifierConfig): boolean {
  return Boolean(config.powerOnEnhancements?.autoHDMI1);
}

export function isTPLinkPowerCheckEnabled(config: IRAmplifierConfig): boolean {
  return Boolean(config.powerOnEnhancements?.tplinkPowerCheck);
}

export function getTPLinkPowerOnDelay(config: IRAmplifierConfig): number {
  return config.powerOnEnhancements?.tplinkPowerOnDelay ?? 3;
}

export function isAutoPowerOnDisabled(config: IRAmplifierConfig): boolean {
  return Boolean(config.powerOnEnhancements?.disableAutoPowerOn);
}
