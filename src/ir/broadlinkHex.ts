import { normalizeHex } from './commandHex';

/** Broadlink RM tick ≈ 8192/269 µs (python-broadlink). */
const BROADLINK_TICK_US = 8192 / 269;

export interface DecodedIrSignal {
  carrierHz: number;
  repeat: number;
  pulses: number[];
}

/**
 * Decode a Broadlink RM hex frame (typically starting with 2600…) into
 * raw pulse/space durations. The same payload can be replayed on GPIO via ir-ctl.
 */
export function decodeBroadlinkHex(hex: string, carrierHz = 38000): DecodedIrSignal {
  const bytes = Buffer.from(normalizeHex(hex), 'hex');
  if (bytes.length < 5) {
    throw new Error('Trame IR Broadlink trop courte');
  }

  const isIr = bytes[0] === 0x26;
  const repeat = isIr ? bytes[1] : 0;
  const payload = isIr ? bytes.subarray(4) : bytes;

  const pulses: number[] = [];
  let i = 0;
  while (i < payload.length) {
    let units: number;
    if (payload[i] === 0) {
      if (i + 2 >= payload.length) {
        break;
      }
      units = (payload[i + 1] << 8) + payload[i + 2];
      i += 3;
    } else {
      units = payload[i];
      i += 1;
    }
    pulses.push(Math.max(1, Math.round(units * BROADLINK_TICK_US)));
  }

  if (pulses.length < 2) {
    throw new Error('Aucun pulse IR décodé depuis la trame Broadlink');
  }

  return { carrierHz, repeat, pulses };
}

export function pulsesToIrCtl(signal: DecodedIrSignal): string {
  const lines = [`carrier ${signal.carrierHz}`, 'duty_cycle 50'];
  for (let i = 0; i < signal.pulses.length; i++) {
    lines.push(`${i % 2 === 0 ? 'pulse' : 'space'} ${signal.pulses[i]}`);
  }
  return `${lines.join('\n')}\n`;
}
