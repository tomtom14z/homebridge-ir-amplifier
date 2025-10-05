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
      hdmi1?: string;
    };
  };
  volumeInit?: {
    enabled: boolean;
    maxVolumeSteps: number;
    startupVolume: number;
    delayBetweenSteps: number;
  };
  powerOnEnhancements?: {
    autoHDMI1: boolean;
    tplinkPowerCheck: boolean;
    tplinkPowerOnDelay: number;
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

  /**
   * Initialize volume to a known state
   * 1. Send volume down commands to reach minimum volume
   * 2. Send volume up commands to reach startup volume
   */
  async initializeVolume(): Promise<boolean> {
    if (!this.config.volumeInit?.enabled) {
      this.log.info('Volume initialization is disabled');
      return true;
    }

    const { maxVolumeSteps, startupVolume, delayBetweenSteps } = this.config.volumeInit;
    
    this.log.info(`Volume initialization starting: maxSteps=${maxVolumeSteps}, startupVolume=${startupVolume}, delay=${delayBetweenSteps}ms`);

    try {
      // Step 1: Send volume down commands to reach minimum volume
      this.log.info(`Sending ${maxVolumeSteps} volume down commands to reach minimum volume...`);
      for (let i = 0; i < maxVolumeSteps; i++) {
        const success = await this.sendCommand(this.config.broadlink.commands.volumeDown);
        if (!success) {
          this.log.error(`Failed to send volume down command ${i + 1}/${maxVolumeSteps}`);
          return false;
        }
        
        // Wait between commands
        if (i < maxVolumeSteps - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenSteps));
        }
      }

      this.log.info('Volume set to minimum, waiting 1 second before setting startup volume...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: Send volume up commands to reach startup volume (absolute value)
      const volumeUpSteps = Math.min(startupVolume, maxVolumeSteps); // Utiliser la valeur absolue, limitée au max
      this.log.info(`Sending ${volumeUpSteps} volume up commands to reach startup volume ${startupVolume}...`);
      
      for (let i = 0; i < volumeUpSteps; i++) {
        const success = await this.sendCommand(this.config.broadlink.commands.volumeUp);
        if (!success) {
          this.log.error(`Failed to send volume up command ${i + 1}/${volumeUpSteps}`);
          return false;
        }
        
        // Wait between commands
        if (i < volumeUpSteps - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenSteps));
        }
      }

      this.log.info(`Volume initialization completed successfully - volume set to ${startupVolume}`);
      return true;

    } catch (error) {
      this.log.error('Volume initialization failed:', error);
      return false;
    }
  }

  /**
   * Get the configured startup volume
   */
  getStartupVolume(): number {
    return this.config.volumeInit?.startupVolume || 20;
  }

  /**
   * Send HDMI1 command to switch TV to HDMI1 input
   */
  async sendHDMI1Command(): Promise<boolean> {
    if (!this.config.broadlink.commands.hdmi1) {
      this.log.warn('HDMI1 command not configured - skipping HDMI1 switch');
      return false;
    }

    this.log.info('Sending HDMI1 command to switch TV to HDMI1 input...');
    return this.sendCommand(this.config.broadlink.commands.hdmi1);
  }

  /**
   * Check if power on enhancements are enabled
   */
  isAutoHDMI1Enabled(): boolean {
    return this.config.powerOnEnhancements?.autoHDMI1 || false;
  }

  /**
   * Check if TP-Link power check is enabled
   */
  isTPLinkPowerCheckEnabled(): boolean {
    return this.config.powerOnEnhancements?.tplinkPowerCheck || false;
  }

  /**
   * Get TP-Link power on delay
   */
  getTPLinkPowerOnDelay(): number {
    return this.config.powerOnEnhancements?.tplinkPowerOnDelay || 3;
  }
}
