import { execFile } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { Logger } from 'homebridge';
import { IRAmplifierConfig } from '../types';
import { IrBackend } from './irBackend';
import { IR_COMMAND_LOG_NAMES, IrCommandName } from './irCommands';
import { decodeBroadlinkHex, pulsesToIrCtl } from './broadlinkHex';
import { resolveCommandHex } from './commandHex';

const execFileAsync = promisify(execFile);

export class GpioIrBackend implements IrBackend {
  readonly name = 'gpio';
  private readonly device: string;
  private readonly carrierHz: number;
  private irCtlAvailable: boolean | null = null;

  constructor(
    private readonly log: Logger,
    private readonly config: IRAmplifierConfig,
  ) {
    this.device = config.gpio?.device ?? '/dev/lirc0';
    this.carrierHz = config.gpio?.carrierHz ?? 38000;
    this.log.info(`[IR] Backend GPIO — device=${this.device}, carrier=${this.carrierHz} Hz`);
    this.log.info('[IR] Les trames hex Broadlink existantes sont décodées en pulses bruts');
  }

  isReady(): boolean {
    return existsSync(this.device);
  }

  async send(command: IrCommandName): Promise<boolean> {
    const hex = resolveCommandHex(this.config, command);
    if (!hex) {
      this.log.error(`[IR] Pas de trame hex pour ${IR_COMMAND_LOG_NAMES[command]}`);
      return false;
    }

    if (!this.isReady()) {
      this.log.error(`[IR] Émetteur LIRC introuvable (${this.device})`);
      return false;
    }

    if (!(await this.hasIrCtl())) {
      this.log.error('[IR] ir-ctl introuvable (paquet v4l-utils). GPIO ne peut pas émettre.');
      return false;
    }

    try {
      const signal = decodeBroadlinkHex(hex, this.carrierHz);
      const payload = pulsesToIrCtl(signal);
      const dir = mkdtempSync(join(tmpdir(), 'ir-amp-'));
      const file = join(dir, `${command}.txt`);
      writeFileSync(file, payload);

      const repeats = Math.max(1, signal.repeat || 1);
      await execFileAsync('ir-ctl', [
        '--device', this.device,
        '--send', file,
        ...(repeats > 1 ? ['--gap', '40000'] : []),
      ]);

      if (repeats > 1) {
        for (let i = 1; i < repeats; i++) {
          await execFileAsync('ir-ctl', ['--device', this.device, '--send', file]);
        }
      }

      rmSync(dir, { recursive: true, force: true });
      this.log.info(`[IR] ${IR_COMMAND_LOG_NAMES[command]} sent (gpio, ${signal.pulses.length} pulses)`);
      return true;
    } catch (error) {
      this.log.error(`[IR] Échec GPIO ${IR_COMMAND_LOG_NAMES[command]}:`, error);
      return false;
    }
  }

  private async hasIrCtl(): Promise<boolean> {
    if (this.irCtlAvailable !== null) {
      return this.irCtlAvailable;
    }
    try {
      await execFileAsync('ir-ctl', ['--version']);
      this.irCtlAvailable = true;
    } catch {
      this.irCtlAvailable = false;
    }
    return this.irCtlAvailable;
  }
}
