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
      this.log.debug('CEC Configuration:', {
        deviceName: this.config.deviceName,
        physicalAddress: this.config.physicalAddress,
        logicalAddress: this.config.logicalAddress,
        vendorId: this.config.vendorId,
        osdName: this.config.osdName
      });
      
      // Vérifier si cec-client est disponible
      await this.checkCECAvailability();
      
      // Démarrer le processus CEC
      await this.startCECProcess();
      
      // L'initialisation et le scan sont maintenant gérés dans startCECProcess
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
      setTimeout(async () => {
        if (this.cecProcess && !this.cecProcess.killed) {
          // Marquer comme initialisé AVANT de scanner
          this.isInitialized = true;
          this.log.info('CEC controller initialized successfully');
          
          // Scanner le bus CEC pour découvrir les appareils
          await this.scanCECDevices();
          
          // Démarrer le scan périodique
          this.startPeriodicScan();
          
          resolve();
        } else {
          reject(new Error('Failed to start CEC process'));
        }
      }, 2000);
    });
  }

  private async scanCECDevices() {
    if (!this.isInitialized) {
      this.log.warn('CEC: Cannot scan devices - controller not initialized');
      return;
    }
    
    this.log.info('CEC: Scanning bus for connected devices...');
    
    // Commandes pour scanner le bus CEC
    const scanCommands = [
      'scan',           // Scanner tous les appareils
      'pow 0',          // Demander l'état de la TV (adresse 0)
      'pow 4',          // Demander l'état de l'Apple TV (adresse 4)
      'pow 5',          // Demander l'état de l'amplificateur (adresse 5)
      'poll 0',         // Poller la TV
      'poll 4',         // Poller l'Apple TV
      'poll 5',         // Poller l'amplificateur
    ];

    for (const command of scanCommands) {
      this.log.debug(`CEC: Sending scan command: ${command}`);
      await this.sendCECCommand(command);
      // Petite pause entre les commandes
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    this.log.info('CEC: Device scan completed');
  }

  private startPeriodicScan() {
    // Scanner les appareils toutes les 30 secondes
    setInterval(async () => {
      if (this.isInitialized) {
        this.log.debug('CEC: Periodic device scan...');
        await this.scanCECDevices();
      }
    }, 30000);
  }

  private handleCECMessage(message: string) {
    const lines = message.split('\n');
    
    for (const line of lines) {
      if (line.trim()) {
        // Logger TOUS les messages CEC du bus
        this.logCECBusMessage(line.trim());
        
        if (line.includes('>>')) {
          this.log.debug('CEC Command Detected:', line.trim());
          this.parseCECCommand(line);
        }
      }
    }
  }

  private logCECBusMessage(message: string) {
    // Analyser le type de message CEC
    if (message.includes('>>')) {
      // Message reçu (incoming)
      const decodedMessage = this.decodeCECMessage(message);
      this.log.info(`CEC BUS: RECEIVED >> ${message} ${decodedMessage}`);
    } else if (message.includes('<<')) {
      // Message envoyé (outgoing)
      const decodedMessage = this.decodeCECMessage(message);
      this.log.info(`CEC BUS: SENT << ${message} ${decodedMessage}`);
    } else if (message.includes('TRAFFIC')) {
      // Trafic CEC général
      this.log.info(`CEC BUS: TRAFFIC ${message}`);
    } else if (message.includes('key pressed:')) {
      // Touches pressées
      this.log.info(`CEC BUS: KEY PRESSED ${message}`);
    } else if (message.includes('power status')) {
      // État d'alimentation
      this.log.info(`CEC BUS: POWER STATUS ${message}`);
    } else if (message.includes('volume')) {
      // Commandes de volume
      this.log.info(`CEC BUS: VOLUME ${message}`);
    } else if (message.includes('mute')) {
      // Commandes de mute
      this.log.info(`CEC BUS: MUTE ${message}`);
    } else if (message.includes('source')) {
      // Changements de source
      this.log.info(`CEC BUS: SOURCE ${message}`);
    } else if (message.includes('device')) {
      // Informations sur les appareils
      this.log.info(`CEC BUS: DEVICE ${message}`);
    } else {
      // Autres messages CEC
      this.log.debug(`CEC BUS: OTHER ${message}`);
    }
  }

  private decodeCECMessage(message: string): string {
    try {
      // Extraire les adresses et commandes CEC
      const match = message.match(/(\d+):(\d+):([0-9A-Fa-f:]+)/);
      if (match) {
        const [, from, to, command] = match;
        const fromDevice = this.getCECDeviceName(parseInt(from));
        const toDevice = this.getCECDeviceName(parseInt(to));
        const commandName = this.getCECCommandName(command);
        
        return `[${fromDevice}(${from}) → ${toDevice}(${to})] ${commandName}`;
      }
    } catch (error) {
      // Ignorer les erreurs de décodage
    }
    return '';
  }

  private getCECDeviceName(address: number): string {
    const deviceNames: { [key: number]: string } = {
      0: 'TV',
      1: 'Recording Device 1',
      2: 'Recording Device 2', 
      3: 'Tuner 1',
      4: 'Playback Device 1',
      5: 'Audio System', // Notre amplificateur
      6: 'Tuner 2',
      7: 'Tuner 3',
      8: 'Playback Device 2',
      9: 'Recording Device 3',
      10: 'Tuner 4',
      11: 'Playback Device 3',
      12: 'Reserved',
      13: 'Reserved',
      14: 'Reserved',
      15: 'Unregistered'
    };
    return deviceNames[address] || `Device ${address}`;
  }

  private getCECCommandName(command: string): string {
    const commandNames: { [key: string]: string } = {
      '82:10:00': 'Image View On',
      '82:00:00': 'Image View Off',
      '44': 'User Control Pressed - Mute',
      '45': 'User Control Pressed - Unmute',
      '41': 'User Control Pressed - Volume Up',
      '42': 'User Control Pressed - Volume Down',
      '50': 'User Control Pressed - Volume',
      '83': 'Standby',
      '04': 'Menu Request',
      '05': 'Menu Status',
      '46': 'User Control Pressed - Channel Up',
      '47': 'User Control Pressed - Channel Down'
    };
    return commandNames[command] || `Command ${command}`;
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
      this.log.debug(`CEC: Sending raw command to cec-client: ${command}`);
      this.cecProcess.stdin?.write(command + '\n');
      this.log.debug('CEC: Command successfully sent to cec-client');
      return true;
    } catch (error) {
      this.log.error('CEC: Failed to send command to cec-client:', error);
      return false;
    }
  }

  async setPowerState(isOn: boolean): Promise<boolean> {
    const command = isOn ? 'tx 4F:82:10:00' : 'tx 4F:82:10:00'; // Image View On/Standby
    this.log.info(`CEC: Sending power state command - ${isOn ? 'ON' : 'OFF'}`);
    this.log.debug(`CEC: Power command: ${command}`);
    return this.sendCECCommand(command);
  }

  async setVolume(volume: number): Promise<boolean> {
    // Envoyer la commande de volume absolu
    const volumeHex = volume.toString(16).padStart(2, '0');
    const command = `tx 4F:50:${volumeHex}`; // User Control Pressed
    this.log.info(`CEC: Sending volume command - Volume: ${volume} (0x${volumeHex})`);
    this.log.debug(`CEC: Volume command: ${command}`);
    return this.sendCECCommand(command);
  }

  async setMute(isMuted: boolean): Promise<boolean> {
    const command = isMuted ? 'tx 4F:44' : 'tx 4F:45'; // Mute/Unmute
    this.log.info(`CEC: Sending mute command - ${isMuted ? 'MUTE' : 'UNMUTE'}`);
    this.log.debug(`CEC: Mute command: ${command}`);
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
