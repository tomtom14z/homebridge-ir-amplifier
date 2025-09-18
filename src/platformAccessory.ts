import { API, Characteristic, CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
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
  
  // Gestion de l'état temporaire pour TP-Link
  private pendingStateChange = false;
  private lastStateChangeTime = 0;
  private stateChangeTimeout: NodeJS.Timeout | null = null;

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

  private async setPowerState(value: CharacteristicValue) {
    const boolValue = value as boolean;
    this.log.info('=== SET POWER STATE CALLED ===');
    this.log.info('Requested state:', boolValue);
    this.log.info('Current accessory state:', this.isOn);
    this.log.info('Pending state change:', this.pendingStateChange);
    
    // Vérifier l'état actuel de TP-Link
    const currentTpLinkState = await this.tplinkController.getInUseState();
    this.log.info('Current TP-Link state (inUse):', currentTpLinkState);
    
    if (boolValue !== currentTpLinkState) {
      this.log.info('State change needed - TP-Link:', currentTpLinkState, '→ Requested:', boolValue);
      
      // Marquer qu'un changement d'état est en cours
      this.pendingStateChange = true;
      this.lastStateChangeTime = Date.now();
      this.log.info('Pending state change flag set to TRUE');
      
      // Mettre à jour immédiatement l'état dans HomeKit (état temporaire)
      this.isOn = boolValue;
      this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
      this.log.info('HomeKit state set to temporary state:', this.isOn);
      
      // Envoyer la commande IR via Broadlink
      this.log.info('Sending IR command to change amplifier state');
      const success = boolValue 
        ? await this.broadlinkController.powerOn()
        : await this.broadlinkController.powerOff();
      
      if (success) {
        this.log.info('IR command sent successfully, scheduling verification');
        // Programmer une vérification différée de l'état TP-Link
        this.scheduleStateVerification(boolValue);
      } else {
        this.log.error('Failed to send IR command');
        // Remettre l'état précédent en cas d'échec
        this.isOn = currentTpLinkState;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.pendingStateChange = false;
        this.log.info('State reverted due to IR command failure');
      }
    } else {
      this.log.info('No state change needed - already matches');
      // S'assurer que HomeKit reflète l'état réel
      this.isOn = currentTpLinkState;
      this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
    }
    
    this.log.info('=== SET POWER STATE COMPLETED ===');
  }

  private scheduleStateVerification(expectedState: boolean) {
    // Annuler la vérification précédente si elle existe
    if (this.stateChangeTimeout) {
      clearTimeout(this.stateChangeTimeout);
    }
    
    this.log.info('Scheduling state verification in 15 seconds for expected state:', expectedState);
    
    // Programmer la vérification après 15 secondes (délai pour que TP-Link se mette à jour)
    this.stateChangeTimeout = setTimeout(async () => {
      await this.verifyStateChange(expectedState);
    }, 15000);
  }

  private async verifyStateChange(expectedState: boolean) {
    try {
      this.log.info('=== VERIFYING STATE CHANGE ===');
      this.log.info('Expected state:', expectedState);
      this.log.info('Current accessory state:', this.isOn);
      this.log.info('Pending state change:', this.pendingStateChange);
      
      // Vérifier l'état actuel de TP-Link
      const actualTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('TP-Link state after delay:', actualTpLinkState, 'Expected:', expectedState);
      
      if (actualTpLinkState === expectedState) {
        // L'état correspond, confirmer
        this.log.info('State change confirmed - TP-Link matches expected state');
        this.isOn = actualTpLinkState;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('HomeKit state confirmed to:', this.isOn);
        
        // Notifier CEC de l'état confirmé
        await this.cecController.setPowerState(this.isOn);
      } else {
        // L'état ne correspond pas, corriger
        this.log.warn('State mismatch detected - TP-Link:', actualTpLinkState, 'Expected:', expectedState);
        this.log.info('Correcting HomeKit state to match TP-Link reality');
        
        this.isOn = actualTpLinkState;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('HomeKit state corrected to:', this.isOn);
        
        // Notifier CEC de l'état réel
        await this.cecController.setPowerState(this.isOn);
      }
      
      // Marquer que le changement d'état est terminé
      this.pendingStateChange = false;
      this.stateChangeTimeout = null;
      this.log.info('State verification completed, pending flag cleared');
      
    } catch (error) {
      this.log.error('Error during state verification:', error);
      this.pendingStateChange = false;
      this.stateChangeTimeout = null;
    }
  }

  private async getPowerState(): Promise<boolean> {
    this.log.debug('=== GET POWER STATE CALLED ===');
    this.log.debug('Pending state change:', this.pendingStateChange);
    
    // Check TP-Link power consumption to determine if amplifier is on
    const inUse = await this.tplinkController.getInUseState();
    this.log.debug('TP-Link inUse:', inUse, 'Current accessory state:', this.isOn);
    
    // Ne pas mettre à jour l'état si un changement est en cours
    if (!this.pendingStateChange) {
      this.isOn = inUse;
      this.log.debug('Accessory state updated to:', this.isOn);
    } else {
      this.log.debug('Skipping state update - pending state change in progress');
    }
    
    this.log.debug('Returning power state:', this.isOn);
    return this.isOn;
  }

  private async setVolume(value: CharacteristicValue) {
    const numValue = value as number;
    this.log.info('Setting volume to:', value);
    this.targetVolume = numValue;
    
    if (this.volumeSyncInProgress) {
      this.log.debug('Volume sync in progress, skipping');
      return;
    }

    await this.syncVolumeToTarget();
    
    // Notifier CEC du nouveau volume
    await this.cecController.setVolume(numValue);
  }

  private async getVolume(): Promise<number> {
    // Check OCR for current volume if enough time has passed
    const now = Date.now();
    if (now - this.lastOCRCheck > 10000) { // Check every 10 seconds
      await this.checkOCRVolume();
    }
    
    return this.currentVolume;
  }

  private async setVolumeBrightness(value: CharacteristicValue) {
    const numValue = value as number;
    // Map brightness (0-100) to volume (0-100)
    await this.setVolume(numValue);
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
    this.tplinkController.startPowerMonitoring(async (inUse: boolean) => {
      this.log.debug('=== TP-LINK MONITORING CALLBACK ===');
      this.log.debug('TP-Link inUse:', inUse, 'Accessory state:', this.isOn);
      this.log.debug('Pending state change:', this.pendingStateChange);
      
      if (inUse !== this.isOn) {
        this.log.info('TP-Link: Power state changed:', this.isOn, '→', inUse);
        
        // Ne pas interférer si un changement d'état est en cours
        if (this.pendingStateChange) {
          this.log.info('TP-Link: Ignoring state change - pending state change in progress');
          return;
        }
        
        this.isOn = inUse;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('TP-Link: Updated HomeKit power state to:', this.isOn);
        
        // Délai avant de synchroniser CEC pour éviter les conflits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Synchroniser l'état CEC avec TP-Link
        this.log.info('TP-Link: Synchronizing CEC state with TP-Link:', this.isOn);
        await this.cecController.setPowerState(this.isOn);
      } else {
        this.log.debug('TP-Link: No state change needed');
      }
    });

    // Start periodic OCR checking
    this.ocrController.startPeriodicCheck((result: OCRResult) => {
      this.checkOCRVolume();
    });

    // Start periodic state verification
    this.startPeriodicStateVerification();

    // Initial state check and synchronization
    this.initializeStateSynchronization();
  }

  private startPeriodicStateVerification() {
    // Vérifier l'état toutes les 15 secondes pour s'assurer de la cohérence
    setInterval(async () => {
      try {
        this.log.debug('=== PERIODIC VERIFICATION ===');
        this.log.debug('Pending state change:', this.pendingStateChange);
        this.log.debug('Current accessory state:', this.isOn);
        
        // Ne pas vérifier si un changement d'état est en cours
        if (this.pendingStateChange) {
          this.log.debug('Skipping periodic verification - state change in progress');
          return;
        }
        
        const tpLinkState = await this.tplinkController.getInUseState();
        this.log.debug('TP-Link state:', tpLinkState, 'Accessory state:', this.isOn);
        
        if (tpLinkState !== this.isOn) {
          this.log.info('Periodic check - State mismatch detected - TP-Link:', tpLinkState, 'Accessory:', this.isOn);
          this.log.info('Correcting accessory state to match TP-Link');
          
          // Corriger l'état de l'accessoire
          this.isOn = tpLinkState;
          this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
          this.log.info('Accessory state corrected to:', this.isOn);
          
          // Notifier CEC de l'état corrigé
          await this.cecController.setPowerState(this.isOn);
        } else {
          this.log.debug('Periodic check - States match, no correction needed');
        }
      } catch (error) {
        this.log.error('Error during periodic state verification:', error);
      }
    }, 15000); // Vérifier toutes les 15 secondes
  }

  private async initializeStateSynchronization() {
    this.log.info('Initializing state synchronization between TP-Link and CEC...');
    
    try {
      // Récupérer l'état actuel de TP-Link (source de vérité)
      const tpLinkState = await this.tplinkController.getInUseState();
      this.log.info('Initial TP-Link state (inUse):', tpLinkState);
      
      // Mettre à jour l'état local de l'accessoire avec l'état réel de TP-Link
      this.isOn = tpLinkState;
      this.log.info('Accessory state synchronized with TP-Link:', this.isOn);
      
      // Mettre à jour HomeKit avec l'état réel (ignorer le cache)
      this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
      this.log.info('HomeKit state updated to real TP-Link state:', this.isOn);
      
      // Récupérer l'état actuel de CEC
      const cecState = this.cecController.getIsOn();
      this.log.info('Initial CEC state:', cecState);
      
      // Délai avant la synchronisation initiale CEC
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Synchroniser CEC avec TP-Link (source de vérité)
      if (tpLinkState !== cecState) {
        this.log.info('Synchronizing CEC with TP-Link state:', tpLinkState);
        await this.cecController.setPowerState(tpLinkState);
      }
      
      // Récupérer le volume initial
      await this.getVolume();
      
      this.log.info('State synchronization completed - Accessory:', this.isOn, 'TP-Link:', tpLinkState, 'CEC:', cecState);
    } catch (error) {
      this.log.error('Error during state synchronization:', error);
    }
  }

  private initializeCECCallbacks() {
    // Callback pour les changements d'état d'alimentation via CEC
    this.cecController.onPowerStateChangeCallback(async (isOn: boolean) => {
      this.log.info('CEC: Power state change received from Apple TV:', isOn);
      this.log.debug('CEC: Current amplifier state (TP-Link):', this.isOn, 'New CEC state:', isOn);
      
      // Vérifier l'état actuel de TP-Link
      const currentTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('CEC: Current TP-Link state:', currentTpLinkState, 'CEC requested state:', isOn);
      
      if (isOn !== currentTpLinkState) {
        this.log.info('CEC: Synchronizing amplifier state - TP-Link:', currentTpLinkState, '→ CEC:', isOn);
        
        // Envoyer la commande IR pour synchroniser l'amplificateur
        if (isOn) {
          this.log.info('CEC: Apple TV requested amplifier ON - sending IR power command to turn ON');
          await this.broadlinkController.powerToggle();
        } else {
          this.log.info('CEC: Apple TV requested amplifier OFF - sending IR power command to turn OFF');
          await this.broadlinkController.powerToggle();
        }
        
        // Attendre un peu pour que la commande IR prenne effet
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Vérifier le nouvel état TP-Link
        const newTpLinkState = await this.tplinkController.getInUseState();
        this.log.info('CEC: After IR command - TP-Link state:', newTpLinkState);
        
        // Mettre à jour l'état local et HomeKit
        this.isOn = newTpLinkState;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('CEC: Updated HomeKit power state to:', this.isOn);
        
        // Délai avant de notifier CEC pour éviter les boucles de synchronisation
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Notifier CEC de l'état final de l'amplificateur
        await this.cecController.setPowerState(this.isOn);
      } else {
        this.log.debug('CEC: Amplifier state already synchronized, no action needed');
      }
    });

    // Callback pour les changements de volume via CEC
    this.cecController.onVolumeChangeCallback((volume: number) => {
      this.log.info('CEC: Volume change received from Apple TV:', volume);
      this.log.debug('CEC: Current volume:', this.currentVolume, 'New volume:', volume);
      
      if (Math.abs(volume - this.currentVolume) > 2) { // Seuil pour éviter les micro-ajustements
        this.currentVolume = volume;
        this.targetVolume = volume;
        
        this.log.info('CEC: Updating HomeKit volume to:', this.currentVolume);
        
        // Mettre à jour les services HomeKit
        this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        
        // Synchroniser le volume via IR
        this.log.info('CEC: Syncing volume to amplifier via IR commands');
        this.syncVolumeToTarget();
      } else {
        this.log.debug('CEC: Volume change too small, ignoring');
      }
    });

    // Callback pour les changements de mute via CEC
    this.cecController.onMuteChangeCallback((isMuted: boolean) => {
      this.log.info('CEC: Mute state change received from Apple TV:', isMuted);
      this.log.debug('CEC: Current mute state:', this.currentVolume === 0, 'New mute state:', isMuted);
      
      // Ici on pourrait ajouter une logique de mute si l'amplificateur le supporte
      // Pour l'instant, on peut simuler le mute en mettant le volume à 0
      if (isMuted) {
        this.log.info('CEC: Apple TV requested mute - setting volume to 0');
        this.setVolume(0);
      } else {
        this.log.info('CEC: Apple TV requested unmute - restoring previous volume');
        // Restaurer le volume précédent (vous pourriez stocker le volume avant mute)
        this.setVolume(50); // Volume par défaut
      }
    });
  }
}
