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
      this.log.info('=== TP-LINK DEVICE INITIALIZATION ===');
      this.log.info('Connecting to TP-Link device at:', this.config.tplink.host);
      
      this.device = await this.client.getDevice({ host: this.config.tplink.host });
      if (this.device) {
        this.log.info('TP-Link device found successfully!');
        this.log.info('Device alias:', this.device.alias);
        this.log.info('Device model:', this.device.model);
        this.log.info('Device MAC:', this.device.mac);
        this.log.info('Device IP:', this.device.host);
        
        // Log device capabilities
        this.log.info('Device capabilities:', {
          supportsEmeter: this.device.supportsEmeter,
          model: this.device.model,
          deviceType: this.device.deviceType
        });
        
        if (this.device.supportsEmeter) {
          this.log.info('Device supports power monitoring (HS110, etc.)');
        } else {
          this.log.info('Device does not support power monitoring - will use relay state');
        }
        
        // Test initial connection
        try {
          const powerState = await this.device.getPowerState();
          this.log.info('Initial power state test:', powerState);
        } catch (testError) {
          this.log.error('Failed to test initial power state:', testError);
        }
      } else {
        this.log.error('TP-Link device not found at IP:', this.config.tplink.host);
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
    this.log.info('=== getInUseState() CALLED ===');
    try {
      if (!this.device) {
        this.log.error('TP-Link device not initialized');
        return false;
      }

      this.log.debug('=== TP-LINK INUSE DEBUG ===');
      this.log.debug('Device model:', this.device.model);
      this.log.debug('Device supportsEmeter:', this.device.supportsEmeter);

      // Skip direct getInUse method - it's not working correctly
      // Force use of power consumption method for HS110
      this.log.debug('Skipping direct getInUse method, using power consumption method');

      // Fallback: Use power consumption method
      const powerState = await this.device.getPowerState();
      this.log.debug('TP-Link power state:', powerState);
      
      if (!powerState) {
        this.log.debug('TP-Link device is OFF, inUse = false');
        return false;
      }

      // For devices that support energy monitoring (HS110, etc), use power consumption
      if (this.device.supportsEmeter && typeof this.device.getEmeterRealtime === 'function') {
        try {
          const emeter = await this.device.getEmeterRealtime();
          const powerConsumption = emeter.power;
          this.log.info('TP-Link power consumption:', powerConsumption, 'W');
          this.log.info('TP-Link emeter data:', emeter);
          
          // Use the same logic as homebridge-tplink-smarthome plugin
          // Check if device is powered on first
          if (!powerState) {
            this.log.info('TP-Link device is OFF, inUse = false');
            return false;
          }
          
          // Use 3W threshold (same as your homebridge-tplink-smarthome config)
          const threshold = 3; // This should match your inUseThreshold config
          const inUse = powerConsumption > threshold;
          this.log.info('TP-Link inUse state (emeter method):', inUse, '(power:', powerConsumption, 'W, threshold:', threshold, 'W)');
          
          // Log detailed emeter data for debugging
          this.log.debug('Full emeter data:', {
            power: emeter.power,
            voltage: emeter.voltage,
            current: emeter.current,
            total: emeter.total
          });
          
          return inUse;
        } catch (emeterError) {
          this.log.error('Failed to get power consumption:', emeterError);
          this.log.warn('Falling back to power state');
          return powerState;
        }
      } else {
        this.log.debug('Device does not support emeter, using power state');
        return powerState;
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
    this.log.info('Starting TP-Link power monitoring with interval:', interval, 'ms');
    setInterval(async () => {
      try {
        this.log.debug('TP-Link monitoring: Getting inUse state...');
        const inUse = await this.getInUseState();
        this.log.debug('TP-Link monitoring: inUse state:', inUse);
        callback(inUse);
      } catch (error) {
        this.log.error('Error in power monitoring:', error);
      }
    }, interval);
  }
}
