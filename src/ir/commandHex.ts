import { IrCommandsConfig, IRAmplifierConfig } from '../types';
import { IrCommandName } from './irCommands';

export function getIrCommands(config: IRAmplifierConfig): IrCommandsConfig | undefined {
  return config.irCommands ?? config.broadlink?.commands;
}

export function resolveCommandHex(
  config: IRAmplifierConfig,
  command: IrCommandName,
): string | undefined {
  const commands = getIrCommands(config);
  if (!commands) {
    return undefined;
  }

  switch (command) {
    case 'powerOn':
      return commands.powerOn || commands.power;
    case 'powerOff':
      return commands.powerOff || commands.power;
    case 'mute':
      return commands.mute || commands.volumeDown;
    default:
      return commands[command];
  }
}

export function normalizeHex(hex: string): string {
  return hex.replace(/[\s:]/g, '').toLowerCase();
}
