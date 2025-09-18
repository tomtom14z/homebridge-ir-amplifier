import { Logger } from 'homebridge';
import { spawn, ChildProcess } from 'child_process';

export interface CECConfig {
  deviceName: string;
  physicalAddress: string;
  logicalAddress: number;
  vendorId: string;
  osdName: string;
}

export interface CECState {
  isOn: boolean;
  volume: number;
  isMuted: boolean;
  activeSource: boolean;
}

export class CECController {
  private cecProcess: ChildProcess | null = null;
  private isInitialized = false;
  private currentState: CECState = {
    isOn: false,
    volume: 50,
    isMuted: false,
    activeSource: false,
  };

  // Callbacks pour les événements CEC
  private onPowerStateChange?: (isOn: boolean) => void;
  private onVolumeChange?: (volume: number) => void;
  private onMuteChange?: (isMuted: boolean) => void;

  constructor(
    private log: Logger,
    private config: CECConfig,
  ) {
    this.initializeCEC();
  }

  private async initializeCEC() {
    try {
      this.log.info('Initializing CEC controller...');
      
      // Vérifier si cec-client est disponible
      await this.checkCECAvailability();
      
      // Démarrer le processus CEC
      await this.startCECProcess();
      
      this.isInitialized = true;
      this.log.info('CEC controller initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize CEC controller:', error);
    }
  }

  private async checkCECAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkProcess = spawn('which', ['cec-client']);
      
      checkProcess.on('close', (code) => {
        if (code === 0) {
          this.log.info('cec-client found');
          resolve();
        } else {
          reject(new Error('cec-client not found. Please install libcec-utils'));
        }
      });
    });
  }

  private async startCECProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Démarrer cec-client en mode monitoring
      this.cecProcess = spawn('cec-client', [
        '-d', '1', // Debug level
        '-t', 'a', // Type: audio device
        '-p', this.config.physicalAddress, // Physical address
        '-l', this.config.logicalAddress.toString(), // Logical address
        '-n', this.config.deviceName, // Device name
        '-o', this.config.osdName, // OSD name
        '-v', this.config.vendorId, // Vendor ID
      ]);

      this.cecProcess.stdout?.on('data', (data) => {
        this.handleCECMessage(data.toString());
      });

      this.cecProcess.stderr?.on('data', (data) => {
        this.log.debug('CEC stderr:', data.toString());
      });

      this.cecProcess.on('close', (code) => {
        this.log.warn('CEC process closed with code:', code);
        this.isInitialized = false;
      });

      this.cecProcess.on('error', (error) => {
        this.log.error('CEC process error:', error);
        reject(error);
      });

      // Attendre un peu pour que le processus démarre
      setTimeout(() => {
        if (this.cecProcess && !this.cecProcess.killed) {
          resolve();
        } else {
          reject(new Error('Failed to start CEC process'));
        }
      }, 2000);
    });
  }

  private handleCECMessage(message: string) {
    const lines = message.split('\n');
    
    for (const line of lines) {
      if (line.includes('>>')) {
        this.parseCECCommand(line);
      }
    }
  }

  private parseCECCommand(line: string) {
    // Parser les commandes CEC reçues
    if (line.includes('key pressed: power on')) {
      this.log.info('CEC: Power on command received');
      this.currentState.isOn = true;
      this.onPowerStateChange?.(true);
    } else if (line.includes('key pressed: power off')) {
      this.log.info('CEC: Power off command received');
      this.currentState.isOn = false;
      this.onPowerStateChange?.(false);
    } else if (line.includes('key pressed: volume up')) {
      this.log.info('CEC: Volume up command received');
      this.currentState.volume = Math.min(100, this.currentState.volume + 1);
      this.onVolumeChange?.(this.currentState.volume);
    } else if (line.includes('key pressed: volume down')) {
      this.log.info('CEC: Volume down command received');
      this.currentState.volume = Math.max(0, this.currentState.volume - 1);
      this.onVolumeChange?.(this.currentState.volume);
    } else if (line.includes('key pressed: mute')) {
      this.log.info('CEC: Mute command received');
      this.currentState.isMuted = !this.currentState.isMuted;
      this.onMuteChange?.(this.currentState.isMuted);
    } else if (line.includes('key pressed: unmute')) {
      this.log.info('CEC: Unmute command received');
      this.currentState.isMuted = false;
      this.onMuteChange?.(false);
    }
  }

  // Méthodes publiques pour envoyer des commandes CEC
  async sendCECCommand(command: string): Promise<boolean> {
    if (!this.cecProcess || !this.isInitialized) {
      this.log.error('CEC controller not initialized');
      return false;
    }

    try {
      this.cecProcess.stdin?.write(command + '\n');
      this.log.debug('CEC command sent:', command);
      return true;
    } catch (error) {
      this.log.error('Failed to send CEC command:', error);
      return false;
    }
  }

  async setPowerState(isOn: boolean): Promise<boolean> {
    const command = isOn ? 'tx 4F:82:10:00' : 'tx 4F:82:10:00'; // Image View On/Standby
    return this.sendCECCommand(command);
  }

  async setVolume(volume: number): Promise<boolean> {
    // Envoyer la commande de volume absolu
    const volumeHex = volume.toString(16).padStart(2, '0');
    const command = `tx 4F:50:${volumeHex}`; // User Control Pressed
    return this.sendCECCommand(command);
  }

  async setMute(isMuted: boolean): Promise<boolean> {
    const command = isMuted ? 'tx 4F:44' : 'tx 4F:45'; // Mute/Unmute
    return this.sendCECCommand(command);
  }

  // Méthodes pour enregistrer les callbacks
  onPowerStateChangeCallback(callback: (isOn: boolean) => void) {
    this.onPowerStateChange = callback;
  }

  onVolumeChangeCallback(callback: (volume: number) => void) {
    this.onVolumeChange = callback;
  }

  onMuteChangeCallback(callback: (isMuted: boolean) => void) {
    this.onMuteChange = callback;
  }

  // Getters pour l'état actuel
  getCurrentState(): CECState {
    return { ...this.currentState };
  }

  getIsOn(): boolean {
    return this.currentState.isOn;
  }

  getVolume(): number {
    return this.currentState.volume;
  }

  getIsMuted(): boolean {
    return this.currentState.isMuted;
  }

  // Méthode pour arrêter le contrôleur CEC
  async terminate() {
    if (this.cecProcess) {
      this.cecProcess.kill();
      this.cecProcess = null;
      this.isInitialized = false;
      this.log.info('CEC controller terminated');
    }
  }
}
