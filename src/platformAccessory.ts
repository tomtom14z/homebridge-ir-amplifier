import { API, Characteristic, Logger, PlatformAccessory, Service } from 'homebridge';
import { IRAmplifierPlatform } from './index';
import { BroadlinkController } from './broadlinkController';
import { TPLinkController } from './tplinkController';
import { OCRController, OCRResult } from './ocrController';
import { CECController } from './cecController';

export class IRAmplifierAccessory {
  private service: Service;
  private speakerService: Service;
  private volumeService: Service;

  private currentVolume = 50;
  private targetVolume = 50;
  private isOn = false;
  private isSourceCorrect = false;
  private lastOCRCheck = 0;
  private volumeSyncInProgress = false;

  constructor(
    private readonly platform: IRAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly broadlinkController: BroadlinkController,
    private readonly tplinkController: TPLinkController,
    private readonly ocrController: OCRController,
    private readonly cecController: CECController,
  ) {
    this.log = platform.log;
    this.api = platform.api;
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;

    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'IR Amplifier')
      .setCharacteristic(this.Characteristic.Model, 'IR Amplifier')
      .setCharacteristic(this.Characteristic.SerialNumber, 'IR-AMP-001');

    // Main switch service
    this.service = this.accessory.getService(this.Service.Switch) || 
      this.accessory.addService(this.Service.Switch);

    this.service.setCharacteristic(this.Characteristic.Name, 'Amplifier Power');

    this.service.getCharacteristic(this.Characteristic.On)
      .onSet(this.setPowerState.bind(this))
      .onGet(this.getPowerState.bind(this));

    // Speaker service for volume control
    this.speakerService = this.accessory.getService(this.Service.Speaker) || 
      this.accessory.addService(this.Service.Speaker);

    this.speakerService.setCharacteristic(this.Characteristic.Name, 'Amplifier Volume');

    this.speakerService.getCharacteristic(this.Characteristic.Volume)
      .onSet(this.setVolume.bind(this))
      .onGet(this.getVolume.bind(this));

    // Volume service for fine control
    this.volumeService = this.accessory.getService(this.Service.Lightbulb) || 
      this.accessory.addService(this.Service.Lightbulb);

    this.volumeService.setCharacteristic(this.Characteristic.Name, 'Volume Control');
    this.volumeService.setCharacteristic(this.Characteristic.Brightness, this.currentVolume);

    this.volumeService.getCharacteristic(this.Characteristic.Brightness)
      .onSet(this.setVolumeBrightness.bind(this))
      .onGet(this.getVolumeBrightness.bind(this));

    this.initializeMonitoring();
    this.initializeCECCallbacks();
  }

  private log: Logger;
  private api: API;
  private Service: typeof Service;
  private Characteristic: typeof Characteristic;

  private async setPowerState(value: boolean) {
    this.log.info('Setting power state to:', value);
    
    if (value !== this.isOn) {
      // Envoyer la commande IR via Broadlink
      const success = await this.broadlinkController.powerToggle();
      if (success) {
        this.isOn = value;
        this.log.info('Power state changed to:', value);
        
        // Notifier CEC de l'état de l'amplificateur
        await this.cecController.setPowerState(value);
      } else {
        this.log.error('Failed to change power state');
      }
    }
  }

  private async getPowerState(): Promise<boolean> {
    // Check TP-Link power consumption to determine if amplifier is on
    const inUse = await this.tplinkController.getInUseState();
    this.isOn = inUse;
    this.log.debug('Current power state:', this.isOn);
    return this.isOn;
  }

  private async setVolume(value: number) {
    this.log.info('Setting volume to:', value);
    this.targetVolume = value;
    
    if (this.volumeSyncInProgress) {
      this.log.debug('Volume sync in progress, skipping');
      return;
    }

    await this.syncVolumeToTarget();
    
    // Notifier CEC du nouveau volume
    await this.cecController.setVolume(value);
  }

  private async getVolume(): Promise<number> {
    // Check OCR for current volume if enough time has passed
    const now = Date.now();
    if (now - this.lastOCRCheck > 10000) { // Check every 10 seconds
      await this.checkOCRVolume();
    }
    
    return this.currentVolume;
  }

  private async setVolumeBrightness(value: number) {
    // Map brightness (0-100) to volume (0-100)
    await this.setVolume(value);
  }

  private async getVolumeBrightness(): Promise<number> {
    return this.currentVolume;
  }

  private async syncVolumeToTarget() {
    if (this.volumeSyncInProgress) return;
    
    this.volumeSyncInProgress = true;
    this.log.info('Syncing volume from', this.currentVolume, 'to', this.targetVolume);

    try {
      const difference = this.targetVolume - this.currentVolume;
      const steps = Math.abs(difference);
      
      for (let i = 0; i < steps; i++) {
        if (difference > 0) {
          await this.broadlinkController.volumeUp();
          this.currentVolume++;
        } else {
          await this.broadlinkController.volumeDown();
          this.currentVolume--;
        }
        
        // Update services
        this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        
        // Small delay between commands
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      this.log.info('Volume sync completed. Current volume:', this.currentVolume);
    } catch (error) {
      this.log.error('Error during volume sync:', error);
    } finally {
      this.volumeSyncInProgress = false;
    }
  }

  private async checkOCRVolume() {
    try {
      const result: OCRResult = await this.ocrController.getVolumeAndSource();
      this.lastOCRCheck = Date.now();

      if (result.volume !== null && result.confidence > 0.7) {
        const ocrVolume = result.volume;
        const difference = Math.abs(ocrVolume - this.currentVolume);
        
        if (difference > 5) { // Significant difference
          this.log.info('OCR detected volume mismatch. OCR:', ocrVolume, 'Current:', this.currentVolume);
          this.currentVolume = ocrVolume;
          
          // Update services
          this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
          this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        }
      }

      if (result.source !== null) {
        const isVideo2 = result.source.toLowerCase().includes('video 2') || 
                        result.source.toLowerCase().includes('video2');
        this.isSourceCorrect = isVideo2;
        
        if (!isVideo2) {
          this.log.warn('Source is not VIDEO 2. Current source:', result.source);
          // Optionally send source toggle command
          // await this.broadlinkController.sourceToggle();
        }
      }
    } catch (error) {
      this.log.error('Error checking OCR:', error);
    }
  }

  private initializeMonitoring() {
    // Monitor TP-Link power state
    this.tplinkController.startPowerMonitoring((inUse: boolean) => {
      if (inUse !== this.isOn) {
        this.isOn = inUse;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('Power state changed via TP-Link monitoring:', this.isOn);
      }
    });

    // Start periodic OCR checking
    this.ocrController.startPeriodicCheck((result: OCRResult) => {
      this.checkOCRVolume();
    });

    // Initial state check
    this.getPowerState();
    this.getVolume();
  }

  private initializeCECCallbacks() {
    // Callback pour les changements d'état d'alimentation via CEC
    this.cecController.onPowerStateChangeCallback((isOn: boolean) => {
      this.log.info('CEC power state change received:', isOn);
      if (isOn !== this.isOn) {
        this.isOn = isOn;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        
        // Si l'Apple TV demande d'allumer l'amplificateur, envoyer la commande IR
        if (isOn) {
          this.broadlinkController.powerToggle();
        }
      }
    });

    // Callback pour les changements de volume via CEC
    this.cecController.onVolumeChangeCallback((volume: number) => {
      this.log.info('CEC volume change received:', volume);
      if (Math.abs(volume - this.currentVolume) > 2) { // Seuil pour éviter les micro-ajustements
        this.currentVolume = volume;
        this.targetVolume = volume;
        
        // Mettre à jour les services HomeKit
        this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        
        // Synchroniser le volume via IR
        this.syncVolumeToTarget();
      }
    });

    // Callback pour les changements de mute via CEC
    this.cecController.onMuteChangeCallback((isMuted: boolean) => {
      this.log.info('CEC mute state change received:', isMuted);
      // Ici on pourrait ajouter une logique de mute si l'amplificateur le supporte
      // Pour l'instant, on peut simuler le mute en mettant le volume à 0
      if (isMuted) {
        this.setVolume(0);
      }
    });
  }
}
