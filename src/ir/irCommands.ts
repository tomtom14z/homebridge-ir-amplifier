export type IrCommandName =
  | 'power'
  | 'powerOn'
  | 'powerOff'
  | 'source'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'menu'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter';

export const IR_COMMAND_LOG_NAMES: Record<IrCommandName, string> = {
  power: 'POWER',
  powerOn: 'POWER_ON',
  powerOff: 'POWER_OFF',
  source: 'SOURCE',
  volumeUp: 'VOLUME_UP',
  volumeDown: 'VOLUME_DOWN',
  mute: 'MUTE',
  menu: 'MENU',
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  enter: 'ENTER',
};
