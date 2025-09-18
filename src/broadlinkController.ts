import { Logger } from 'homebridge';
// @ts-ignore
import Broadlink from 'kiwicam-broadlinkjs-rm';

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
  private broadlink: any;
  private device: any;

  constructor(
    private log: Logger,
    private config: IRAmplifierConfig,
  ) {
    this.broadlink = new Broadlink();
    this.initializeDevice();
  }

  private async initializeDevice() {
    try {
      this.log.info('Initializing Broadlink device...');
      
      // Create device manually with known IP and MAC
      this.device = {
        host: { address: this.config.broadlink.host },
        mac: this.config.broadlink.mac,
        type: 0x279d, // RM3 Pro Plus type
        name: 'RM3 Pro Plus'
      };

      this.log.info('Broadlink device configured:', this.device.host.address, this.device.mac);
      
      // Test connection by trying to discover (this will populate the device)
      this.broadlink.discover();
      
      // Wait a bit for discovery to complete
      setTimeout(() => {
        this.log.info('Broadlink discovery completed');
      }, 2000);
      
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

      // Convert hex string to buffer
      const commandBuffer = Buffer.from(command, 'hex');
      
      // Use the broadlink instance to send data
      this.broadlink.sendData(this.device, commandBuffer);
      this.log.info('IR command sent:', command, 'to', this.device.host.address);
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
      
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.log.warn('Learning timeout');
          resolve(null);
        }, timeout);

        // Listen for learned data
        this.broadlink.on('rawData', (data: Buffer) => {
          clearTimeout(timer);
          const hexCommand = data.toString('hex');
          this.log.info('Learned command:', hexCommand);
          resolve(hexCommand);
        });

        // Start learning mode
        this.broadlink.enterLearning(this.device);
      });
    } catch (error) {
      this.log.error('Failed to learn IR command:', error);
      return null;
    }
  }
}
