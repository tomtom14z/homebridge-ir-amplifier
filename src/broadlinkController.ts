import { Logger } from 'homebridge';
import { BroadlinkRMPlatform } from 'broadlinkjs-rm';

export interface IRAmplifierConfig {
  broadlink: {
    host: string;
    mac: string;
    commands: {
      power: string;
      source: string;
      volumeUp: string;
      volumeDown: string;
    };
  };
  tplink: {
    host: string;
  };
  ocr: {
    cameraUrl: string;
    checkInterval: number;
  };
}

export class BroadlinkController {
  private broadlink: BroadlinkRMPlatform;
  private device: any;

  constructor(
    private log: Logger,
    private config: IRAmplifierConfig,
  ) {
    this.broadlink = new BroadlinkRMPlatform();
    this.initializeDevice();
  }

  private async initializeDevice() {
    try {
      const devices = await this.broadlink.discover();
      this.device = devices.find((device: any) => 
        device.host.address === this.config.broadlink.host ||
        device.mac === this.config.broadlink.mac
      );

      if (!this.device) {
        this.log.error('Broadlink device not found');
        return;
      }

      this.log.info('Broadlink device found:', this.device.host.address);
    } catch (error) {
      this.log.error('Failed to initialize Broadlink device:', error);
    }
  }

  async sendCommand(command: string): Promise<boolean> {
    try {
      if (!this.device) {
        this.log.error('Broadlink device not initialized');
        return false;
      }

      // Convert hex string to buffer if needed
      const commandBuffer = Buffer.from(command, 'hex');
      await this.device.sendData(commandBuffer);
      this.log.debug('IR command sent:', command);
      return true;
    } catch (error) {
      this.log.error('Failed to send IR command:', error);
      return false;
    }
  }

  async powerToggle(): Promise<boolean> {
    return this.sendCommand(this.config.broadlink.commands.power);
  }

  async sourceToggle(): Promise<boolean> {
    return this.sendCommand(this.config.broadlink.commands.source);
  }

  async volumeUp(): Promise<boolean> {
    return this.sendCommand(this.config.broadlink.commands.volumeUp);
  }

  async volumeDown(): Promise<boolean> {
    return this.sendCommand(this.config.broadlink.commands.volumeDown);
  }

  // Method to learn new IR commands
  async learnCommand(timeout: number = 10000): Promise<string | null> {
    try {
      if (!this.device) {
        this.log.error('Broadlink device not initialized');
        return null;
      }

      this.log.info('Learning IR command... Press the button on your remote');
      const data = await this.device.enterLearning();
      
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
      });
    } catch (error) {
      this.log.error('Failed to learn IR command:', error);
      return null;
    }
  }
}
