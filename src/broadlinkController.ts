import { Logger } from 'homebridge';
// @ts-ignore
import Broadlink from 'kiwicam-broadlinkjs-rm';

export interface IRAmplifierConfig {
  broadlink: {
    host: string;
    mac: string;
    commands: {
      power: string;
      powerOn?: string;
      powerOff?: string;
      source: string;
      volumeUp: string;
      volumeDown: string;
      mute?: string;
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
      
      // Start discovery
      this.broadlink.discover();
      
      // Wait for discovery to complete and find our device
      setTimeout(() => {
        const devices = this.broadlink.devices;
        this.log.info('Discovered devices:', Object.keys(devices).length);
        
        // Find our device by IP or MAC
        for (const [id, device] of Object.entries(devices)) {
          const dev = device as any;
          if (dev.host?.address === this.config.broadlink.host || 
              dev.mac === this.config.broadlink.mac) {
            this.device = dev;
            this.log.info('Broadlink device found:', dev.host?.address, dev.mac);
            break;
          }
        }
        
        if (!this.device) {
          this.log.warn('Broadlink device not found in discovered devices');
          this.log.info('Available devices:', Object.values(devices).map((d: any) => ({
            host: d.host?.address,
            mac: d.mac
          })));
        }
      }, 3000);
      
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
      
      // Use the device's sendData method directly
      await this.device.sendData(commandBuffer);
      this.log.info('IR command sent:', command, 'to', this.device.host?.address);
      return true;
    } catch (error) {
      this.log.error('Failed to send IR command:', error);
      return false;
    }
  }

  async powerToggle(): Promise<boolean> {
    return this.sendCommand(this.config.broadlink.commands.power);
  }

  async powerOn(): Promise<boolean> {
    // Utiliser la commande powerOn si disponible, sinon power
    const command = this.config.broadlink.commands.powerOn || this.config.broadlink.commands.power;
    return this.sendCommand(command);
  }

  async powerOff(): Promise<boolean> {
    // Utiliser la commande powerOff si disponible, sinon power
    const command = this.config.broadlink.commands.powerOff || this.config.broadlink.commands.power;
    return this.sendCommand(command);
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

  async mute(): Promise<boolean> {
    // Si une commande mute est configurée, l'utiliser, sinon utiliser volumeDown pour simuler
    if (this.config.broadlink.commands.mute) {
      return this.sendCommand(this.config.broadlink.commands.mute);
    } else {
      this.log.warn('No mute command configured, using volumeDown as fallback');
      return this.sendCommand(this.config.broadlink.commands.volumeDown);
    }
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

        // Listen for learned data on the device
        this.device.on('rawData', (data: Buffer) => {
          clearTimeout(timer);
          const hexCommand = data.toString('hex');
          this.log.info('Learned command:', hexCommand);
          resolve(hexCommand);
        });

        // Start learning mode on the device
        this.device.enterLearning();
      });
    } catch (error) {
      this.log.error('Failed to learn IR command:', error);
      return null;
    }
  }
}
