import { Logger } from 'homebridge';
import { Client } from 'tplink-smarthome-api';

export class TPLinkController {
  private client: Client;
  private device: any;

  constructor(
    private log: Logger,
    private config: any,
  ) {
    this.client = new Client();
    this.initializeDevice();
  }

  private async initializeDevice() {
    try {
      this.device = await this.client.getDevice({ host: this.config.tplink.host });
      if (this.device) {
        this.log.info('TP-Link device found:', this.device.alias);
        
        // Log device capabilities
        this.log.info('Device capabilities:', {
          supportsEmeter: this.device.supportsEmeter,
          model: this.device.model,
          deviceType: this.device.deviceType
        });
        
        if (this.device.supportsEmeter) {
          this.log.info('Device supports power monitoring');
        } else {
          this.log.info('Device does not support power monitoring - will use relay state');
        }
      } else {
        this.log.error('TP-Link device not found');
      }
    } catch (error) {
      this.log.error('Failed to initialize TP-Link device:', error);
    }
  }

  async getPowerState(): Promise<boolean> {
    try {
      if (!this.device) {
        this.log.error('TP-Link device not initialized');
        return false;
      }

      const powerState = await this.device.getPowerState();
      this.log.debug('TP-Link power state:', powerState);
      return powerState;
    } catch (error) {
      this.log.error('Failed to get TP-Link power state:', error);
      return false;
    }
  }

  async getInUseState(): Promise<boolean> {
    try {
      if (!this.device) {
        this.log.error('TP-Link device not initialized');
        return false;
      }

      // Check if power monitoring is enabled in config (default to true)
      const powerMonitoringEnabled = this.config.tplink?.powerMonitoring !== false;
      
      if (!powerMonitoringEnabled) {
        this.log.debug('Power monitoring disabled in config - using power state instead');
        const powerState = await this.device.getPowerState();
        return powerState; // true = on, false = off
      }

      // Get power threshold from config (default 1W)
      const powerThreshold = this.config.tplink?.powerThreshold || 1;
      
      // Try to get power consumption data using the correct API
      try {
        // Check if device supports emeter (energy monitoring)
        if (this.device.supportsEmeter && typeof this.device.getEmeterRealtime === 'function') {
          const emeter = await this.device.getEmeterRealtime();
          const inUse = emeter.power > powerThreshold;
          this.log.debug('TP-Link in use state:', inUse, 'Power:', emeter.power, 'W', 'Threshold:', powerThreshold, 'W');
          return inUse;
        } else {
          this.log.debug('Device does not support emeter, using power state');
          const powerState = await this.device.getPowerState();
          return powerState; // true = on, false = off
        }
      } catch (emeterError) {
        this.log.warn('Failed to get emeter data, using power state:', (emeterError as Error).message);
        const powerState = await this.device.getPowerState();
        return powerState; // true = on, false = off
      }
    } catch (error) {
      this.log.error('Failed to get TP-Link in use state:', error);
      return false;
    }
  }

  async getPowerConsumption(): Promise<number> {
    try {
      if (!this.device) {
        this.log.error('TP-Link device not initialized');
        return 0;
      }

      // Check if device supports emeter (energy monitoring)
      if (this.device.supportsEmeter && typeof this.device.getEmeterRealtime === 'function') {
        const emeter = await this.device.getEmeterRealtime();
        return emeter.power;
      } else {
        this.log.debug('Device does not support power monitoring');
        return 0;
      }
    } catch (error) {
      this.log.error('Failed to get TP-Link power consumption:', error);
      return 0;
    }
  }

  // Method to monitor power state changes
  startPowerMonitoring(callback: (inUse: boolean) => void, interval: number = 5000) {
    setInterval(async () => {
      try {
        const inUse = await this.getInUseState();
        callback(inUse);
      } catch (error) {
        this.log.error('Error in power monitoring:', error);
      }
    }, interval);
  }
}
