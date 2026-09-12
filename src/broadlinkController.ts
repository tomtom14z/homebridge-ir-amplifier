import { Logger } from 'homebridge';
// @ts-ignore
import Broadlink from 'kiwicam-broadlinkjs-rm';
import { IrBackend } from './ir/irBackend';
import { IR_COMMAND_LOG_NAMES, IrCommandName } from './ir/irCommands';
import { resolveCommandHex, normalizeHex } from './ir/commandHex';
import { IRAmplifierConfig } from './types';

export class BroadlinkController implements IrBackend {
  readonly name = 'broadlink';
  private broadlink: any;
  private device: any;

  constructor(
    private log: Logger,
    private config: IRAmplifierConfig,
  ) {
    this.broadlink = new Broadlink();
    this.initializeDevice();
  }

  isReady(): boolean {
    return Boolean(this.device);
  }

  async send(command: IrCommandName): Promise<boolean> {
    const hex = resolveCommandHex(this.config, command);
    if (!hex) {
      this.log.error(`[IR] No hex payload configured for ${IR_COMMAND_LOG_NAMES[command]}`);
      return false;
    }

    const success = await this.sendHex(hex);
    if (success) {
      this.log.info(`[IR] ${IR_COMMAND_LOG_NAMES[command]} sent`);
    }
    return success;
  }

  private async initializeDevice() {
    try {
      if (!this.config.broadlink?.host && !this.config.broadlink?.mac) {
        this.log.warn('[IR] Broadlink host/MAC non configurés — backend Broadlink inactif');
        return;
      }

      this.log.info('Initializing Broadlink device...');

      this.broadlink.discover();

      setTimeout(() => {
        const devices = this.broadlink.devices;
        this.log.info('Discovered devices:', Object.keys(devices).length);

        for (const [, device] of Object.entries(devices)) {
          const dev = device as any;
          if (dev.host?.address === this.config.broadlink?.host ||
              (this.config.broadlink?.mac && dev.mac === this.config.broadlink.mac)) {
            this.device = dev;
            this.log.info('Broadlink device found:', dev.host?.address, dev.mac);
            break;
          }
        }

        if (!this.device) {
          this.log.warn('Broadlink device not found in discovered devices');
          this.log.info('Available devices:', Object.values(devices).map((d: any) => ({
            host: d.host?.address,
            mac: d.mac,
          })));
        }
      }, 3000);

    } catch (error) {
      this.log.error('Failed to initialize Broadlink device:', error);
    }
  }

  async sendHex(command: string): Promise<boolean> {
    try {
      if (!this.device) {
        this.log.error('Broadlink device not initialized');
        return false;
      }

      const commandBuffer = Buffer.from(normalizeHex(command), 'hex');
      await this.device.sendData(commandBuffer);
      this.log.info('IR command sent:', command, 'to', this.device.host?.address);
      return true;
    } catch (error) {
      this.log.error('Failed to send IR command:', error);
      return false;
    }
  }

  async powerOn(): Promise<boolean> {
    return this.send('powerOn');
  }

  async powerOff(): Promise<boolean> {
    return this.send('powerOff');
  }

  async volumeUp(): Promise<boolean> {
    return this.send('volumeUp');
  }

  async volumeDown(): Promise<boolean> {
    return this.send('volumeDown');
  }

  async mute(): Promise<boolean> {
    if (!this.config.broadlink?.commands?.mute && !this.config.irCommands?.mute) {
      this.log.warn('No mute command configured, using volumeDown as fallback');
    }
    return this.send('mute');
  }

  async learnCommand(timeout: number = 10000): Promise<string | null> {
    try {
      if (!this.device) {
        this.log.error('Broadlink device not initialized');
        return null;
      }

      this.log.info('Learning IR command... Press the button on your remote');

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.log.warn('Learning timeout');
          resolve(null);
        }, timeout);

        this.device.on('rawData', (data: Buffer) => {
          clearTimeout(timer);
          const hexCommand = data.toString('hex');
          this.log.info('Learned command:', hexCommand);
          resolve(hexCommand);
        });

        this.device.enterLearning();
      });
    } catch (error) {
      this.log.error('Failed to learn IR command:', error);
      return null;
    }
  }
}
