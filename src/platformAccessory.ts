import * as fs from 'fs';  // For file watching (Node.js built-in)
import { API, Characteristic, CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import { IRAmplifierPlatform } from './index';
import { BroadlinkController } from './broadlinkController';
import { TPLinkController } from './tplinkController';
import { OCRController, OCRResult } from './ocrController';
// import { CECController } from './cecController'; // Désactivé - utilise le service CEC externe

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
    private readonly cecController: any, // null - utilise le service CEC externe
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
        ? await this.handlePowerOnWithEnhancements()
        : await this.broadlinkController.powerOff();
      
      if (success) {
        this.log.info('IR command sent successfully, scheduling verification');
        // Synchroniser l'état CEC avec le nouvel état
        this.syncCECState(boolValue);
        // Programmer une vérification différée de l'état TP-Link
        this.scheduleStateVerification(boolValue);
        
        // Si on allume l'amplificateur, initialiser le volume
        if (boolValue) {
          this.log.info('Amplifier power ON - starting volume initialization...');
          // Attendre un peu que l'amplificateur s'allume avant d'initialiser le volume
          setTimeout(() => {
            this.initializeVolumeAfterPowerOn();
          }, 3000); // 3 secondes après l'allumage
        }
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
        
        // Synchroniser l'état CEC avec l'état confirmé
        this.syncCECState(this.isOn);
      } else {
        // L'état ne correspond pas, corriger
        this.log.warn('State mismatch detected - TP-Link:', actualTpLinkState, 'Expected:', expectedState);
        this.log.info('Correcting HomeKit state to match TP-Link reality');
        
        this.isOn = actualTpLinkState;
        this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
        this.log.info('HomeKit state corrected to:', this.isOn);
        
        // Synchroniser l'état CEC avec l'état corrigé
        this.syncCECState(this.isOn);
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
    
    // CEC géré par le service externe - pas d'action nécessaire
    this.log.debug('Volume changed - CEC handled by external service');
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
        
        // Synchroniser l'état CEC avec TP-Link (local seulement)
        this.log.debug('TP-Link: CEC state synchronized locally with TP-Link:', this.isOn);
      } else {
        this.log.debug('TP-Link: No state change needed');
        
        // Même si pas de changement d'état, s'assurer que CEC est synchronisé localement
        this.log.debug('TP-Link: CEC state synchronized locally with current state:', this.isOn);
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
          
          // CEC synchronisé localement avec l'état corrigé
          this.log.debug('CEC: State corrected locally:', this.isOn);
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
      
      // CEC géré par le service externe
      this.log.info('CEC handled by external service - no internal CEC state');
      
      // Délai avant la synchronisation initiale CEC
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Synchroniser l'état CEC avec l'état initial
      this.syncCECState(this.isOn);
      this.log.info('CEC: Initial state synchronized with CEC bus');
      
      // Récupérer le volume initial
      await this.getVolume();
      
      this.log.info('State synchronization completed - Accessory:', this.isOn, 'TP-Link:', tpLinkState, 'CEC: external service');
    } catch (error) {
      this.log.error('Error during state synchronization:', error);
    }
  }

  private initializeCECCallbacks() {
    // CEC géré par le service externe - pas de callbacks internes
    this.log.info('CEC callbacks handled by external service');
    
    // Démarrer le watcher pour le service CEC externe
    this.startExternalCECWatcher();
  }

  private startExternalCECWatcher() {
    // Surveiller le fichier de communication avec le service CEC externe
    const fs = require('fs');
    const path = '/var/lib/homebridge/cec-to-homebridge.json';
    
    this.log.info('Starting external CEC service watcher...');
    
    const watcher = setInterval(() => {
      try {
        if (fs.existsSync(path)) {
          const data = fs.readFileSync(path, 'utf8').trim();
          
          // Vérifier que le fichier n'est pas vide
          if (!data) {
            return; // Fichier vide, ignorer
          }
          
          // Vérifier que c'est du JSON valide
          let command;
          try {
            command = JSON.parse(data);
          } catch (jsonError: any) {
            this.log.warn('CEC: Invalid JSON in communication file:', jsonError.message);
            this.log.debug('CEC: Raw data:', data);
            return; // JSON invalide, ignorer
          }
          
          // Vérifier que la commande a la structure attendue
          if (!command.action || !command.value) {
            this.log.warn('CEC: Invalid command structure:', command);
            return; // Structure invalide, ignorer
          }
          
          this.log.info('CEC: Command received from external CEC service:', command);
          
          switch (command.action) {
            case 'power':
              if (command.value === 'on') {
                this.log.info('CEC: Power ON from external service');
                this.handleCECPowerOn();
              } else if (command.value === 'off' || command.value === 'standby') {
                this.log.info('CEC: Power OFF/STANDBY from external service');
                this.handleCECPowerOff();
              }
              break;
              
            case 'volume':
              if (command.value === 'up') {
                this.log.info('CEC: Volume UP from external service');
                this.handleCECVolumeUp();
              } else if (command.value === 'down') {
                this.log.info('CEC: Volume DOWN from external service');
                this.handleCECVolumeDown();
              }
              break;
              
            case 'mute':
              this.log.info('CEC: Mute toggle from external service');
              this.handleCECMuteToggle();
              break;
          }
          
          // Vider le fichier après traitement (plus fiable que la suppression)
          try {
            fs.writeFileSync(path, '');
            this.log.debug('CEC: Communication file cleared');
          } catch (clearError: any) {
            this.log.warn('CEC: Could not clear communication file:', clearError.message);
            // Essayer de supprimer en dernier recours
            try {
              fs.unlinkSync(path);
              this.log.debug('CEC: Communication file deleted');
            } catch (unlinkError: any) {
              this.log.warn('CEC: Could not delete communication file (will be overwritten on next command):', unlinkError.message);
            }
          }
        }
      } catch (error) {
        this.log.error('CEC: Error reading external CEC service file:', error);
      }
    }, 100); // Vérifier toutes les 100ms
    
    // Stocker le watcher pour le nettoyage
    this.externalCECWatcher = watcher;
  }

  private externalCECWatcher: NodeJS.Timeout | null = null;

  private async handleCECPowerOn() {
    // Vérifier l'état actuel de l'amplificateur avant d'envoyer la commande
    const currentTpLinkState = await this.tplinkController.getInUseState();
    this.log.info('CEC: Apple TV requested amplifier ON - current TP-Link state:', currentTpLinkState);
    
    if (currentTpLinkState) {
      this.log.info('CEC: Amplifier is already ON - skipping IR command to avoid unnecessary power toggle');
      
      // Même si l'amplificateur est déjà allumé, envoyer la commande HDMI1 si activée
      if (this.broadlinkController.isAutoHDMI1Enabled()) {
        this.log.info('CEC: Amplifier already ON - sending HDMI1 command via CEC...');
        const hdmiSuccess = await this.sendCECHdmi1Command();
        if (hdmiSuccess) {
          this.log.info('CEC: HDMI1 CEC command sent successfully');
        } else {
          this.log.warn('CEC: HDMI1 CEC command failed');
        }
      }
      return;
    }
    
    this.log.info('CEC: Amplifier is OFF - preparing to send IR power command');
    
    // Debug: Vérifier la configuration des améliorations
    this.log.info('CEC: Power enhancements config - autoHDMI1:', this.broadlinkController.isAutoHDMI1Enabled());
    this.log.info('CEC: Power enhancements config - tplinkPowerCheck:', this.broadlinkController.isTPLinkPowerCheckEnabled());
    this.log.info('CEC: Power enhancements config - tplinkPowerOnDelay:', this.broadlinkController.getTPLinkPowerOnDelay());
    
    // Utiliser la méthode helper pour gérer l'allumage avec les améliorations
    const success = await this.handlePowerOnWithEnhancements();
    
    if (success) {
      this.log.info('CEC: Power ON command sent successfully');
      
      // 4. Attendre un peu pour que la commande IR prenne effet
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 5. Vérifier le nouvel état TP-Link
      const newTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('CEC: After IR command - TP-Link state:', newTpLinkState);
      
      // 6. Mettre à jour l'état local et HomeKit
      this.isOn = newTpLinkState;
      this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
      this.log.info('CEC: Updated HomeKit power state to:', this.isOn);
      
      // 7. Initialiser le volume si l'amplificateur est maintenant allumé
      if (this.isOn) {
        this.log.info('CEC: Amplifier is now ON - starting volume initialization...');
        await this.initializeVolumeAfterPowerOn();
      }
    } else {
      this.log.error('CEC: Failed to send power ON command');
    }
  }

  private async handleCECPowerOff() {
    // Vérifier l'état actuel de l'amplificateur avant d'envoyer la commande
    const currentTpLinkState = await this.tplinkController.getInUseState();
    this.log.info('CEC: Apple TV requested amplifier OFF - current TP-Link state:', currentTpLinkState);
    
    if (!currentTpLinkState) {
      this.log.info('CEC: Amplifier is already OFF - skipping IR command to avoid unnecessary power toggle');
      return;
    }
    
    this.log.info('CEC: Amplifier is ON - sending IR power command to turn OFF');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.broadlinkController.powerOff();
    
    if (success) {
      this.log.info('CEC: Power OFF command sent successfully');
      
      // Attendre un peu pour que la commande IR prenne effet
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Vérifier le nouvel état TP-Link
      const newTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('CEC: After IR command - TP-Link state:', newTpLinkState);
      
      // Mettre à jour l'état local et HomeKit
      this.isOn = newTpLinkState;
      this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
      this.log.info('CEC: Updated HomeKit power state to:', this.isOn);
    } else {
      this.log.error('CEC: Failed to send power OFF command');
    }
  }

  private async handleCECVolumeUp() {
    this.log.info('CEC: Volume UP requested - sending IR volume up command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.broadlinkController.volumeUp();
    
    if (success) {
      // Mettre à jour le volume local seulement si la commande IR a réussi
      this.currentVolume = Math.min(100, this.currentVolume + 1);
      this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
      this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
      this.log.info('CEC: Volume UP command sent successfully, volume now:', this.currentVolume);
    } else {
      this.log.error('CEC: Failed to send volume UP command');
    }
  }

  private async handleCECVolumeDown() {
    this.log.info('CEC: Volume DOWN requested - sending IR volume down command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.broadlinkController.volumeDown();
    
    if (success) {
      // Mettre à jour le volume local seulement si la commande IR a réussi
      this.currentVolume = Math.max(0, this.currentVolume - 1);
      this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
      this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
      this.log.info('CEC: Volume DOWN command sent successfully, volume now:', this.currentVolume);
    } else {
      this.log.error('CEC: Failed to send volume DOWN command');
    }
  }

  private async handleCECMuteToggle() {
    this.log.info('CEC: Mute toggle requested - sending IR mute command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.broadlinkController.mute();
    
    if (success) {
      // Basculer l'état mute
      this.currentVolume = this.currentVolume === 0 ? 50 : 0; // Toggle entre 0 et 50
      this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
      this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
      this.log.info('CEC: Mute command sent successfully, volume now:', this.currentVolume);
    } else {
      this.log.error('CEC: Failed to send mute command');
    }
  }

  private syncCECState(powerState: boolean) {
    // Synchroniser l'état CEC avec l'état HomeKit
    // Écrire l'état dans un fichier que le script CEC peut lire
    try {
      const fs = require('fs');
      const path = '/var/lib/homebridge/homebridge-to-cec.json';
      
      const stateData = {
        power: powerState ? 'on' : 'off',
        timestamp: Date.now(),
        source: 'homebridge'
      };
      
      // Écrire de manière atomique pour éviter la corruption
      const tempPath = path + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(stateData, null, 2));
      
      // Définir les permissions pour que le script CEC (root) puisse lire
      fs.chmodSync(tempPath, 0o644); // rw-r--r--
      
      // Déplacer le fichier de manière atomique
      fs.renameSync(tempPath, path);
      
      this.log.info('CEC: Amplifier state written to CEC communication file:', powerState ? 'ON' : 'OFF');
      this.log.debug('CEC: State data:', stateData);
      
    } catch (error) {
      this.log.error('CEC: Error writing state to CEC communication file:', error);
    }
  }

  /**
   * Initialize volume after amplifier power on
   * This ensures the virtual volume matches the physical amplifier volume
   */
  private async initializeVolumeAfterPowerOn() {
    try {
      this.log.info('Starting volume initialization after power on...');
      
      // Appeler la méthode d'initialisation du volume du BroadlinkController
      const success = await this.broadlinkController.initializeVolume();
      
      if (success) {
        this.log.info('Volume initialization completed successfully');
        
        // Mettre à jour le volume virtuel HomeKit avec le volume de démarrage configuré
        const startupVolume = this.broadlinkController.getStartupVolume();
        this.currentVolume = startupVolume;
        this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
        this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
        this.log.info(`HomeKit volume updated to startup volume: ${this.currentVolume}%`);
      } else {
        this.log.error('Volume initialization failed');
      }
    } catch (error) {
      this.log.error('Error during volume initialization:', error);
    }
  }

  /**
   * Handle power on with enhancements (TP-Link check and HDMI1)
   * Used by both HomeKit and CEC power on events
   */
  private async handlePowerOnWithEnhancements(): Promise<boolean> {
    this.log.info('handlePowerOnWithEnhancements: Starting enhanced power on sequence');
    
    // 1. Vérifier et allumer la prise TP-Link si nécessaire
    if (this.broadlinkController.isTPLinkPowerCheckEnabled()) {
      this.log.info('handlePowerOnWithEnhancements: TP-Link power check is ENABLED');
      this.log.info('Checking TP-Link plug power state...');
      const plugReady = await this.tplinkController.ensurePlugIsOn();
      
      if (!plugReady) {
        this.log.error('Failed to ensure TP-Link plug is ON - aborting power on');
        return false;
      }
      
      // Attendre le délai configuré après l'allumage de la prise
      const delay = this.broadlinkController.getTPLinkPowerOnDelay();
      this.log.info(`Waiting ${delay} seconds after TP-Link plug power on...`);
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    } else {
      this.log.info('handlePowerOnWithEnhancements: TP-Link power check is DISABLED');
    }
    
    // 2. Envoyer la commande IR d'allumage
    this.log.info('handlePowerOnWithEnhancements: Sending IR power command to turn ON amplifier');
    const success = await this.broadlinkController.powerOn();
    
    if (success) {
      this.log.info('handlePowerOnWithEnhancements: IR power command sent successfully');
      
      // 3. Envoyer la commande HDMI1 via CEC si activée
      if (this.broadlinkController.isAutoHDMI1Enabled()) {
        this.log.info('handlePowerOnWithEnhancements: Auto HDMI1 is ENABLED');
        this.log.info('Sending HDMI1 command via CEC to switch TV to HDMI1...');
        const hdmiSuccess = await this.sendCECHdmi1Command();
        if (hdmiSuccess) {
          this.log.info('HDMI1 CEC command sent successfully');
        } else {
          this.log.warn('HDMI1 CEC command failed');
        }
      } else {
        this.log.info('handlePowerOnWithEnhancements: Auto HDMI1 is DISABLED');
      }
    } else {
      this.log.error('handlePowerOnWithEnhancements: IR power command failed');
    }
    
    this.log.info('handlePowerOnWithEnhancements: Enhanced power on sequence completed, success:', success);
    return success;
  }

  /**
   * Send HDMI1 command via CEC to switch TV to HDMI1 input
   */
  private async sendCECHdmi1Command(): Promise<boolean> {
    try {
      this.log.info('Sending CEC HDMI1 command to switch TV to HDMI1...');
      
      // Utiliser cec-ctl pour envoyer la commande HDMI1
      const { spawn } = require('child_process');
      
      return new Promise((resolve) => {
        // Commande CEC pour basculer sur HDMI1 (physical address 1.0.0.0)
        const cecProcess = spawn('cec-ctl', [
          '-d', '/dev/cec0',
          '--to', '0',  // TV (device 0)
          '--active-source', '1.0.0.0'  // Physical address HDMI1
        ]);

        let output = '';
        let errorOutput = '';

        cecProcess.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        cecProcess.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        cecProcess.on('close', (code: number) => {
          if (code === 0) {
            this.log.info('CEC HDMI1 command sent successfully');
            this.log.debug('CEC HDMI1 output:', output);
            resolve(true);
          } else {
            this.log.error('CEC HDMI1 command failed with code:', code);
            this.log.error('CEC HDMI1 error:', errorOutput);
            resolve(false);
          }
        });

        cecProcess.on('error', (error: Error) => {
          this.log.error('Failed to execute CEC HDMI1 command:', error);
          resolve(false);
        });
      });

    } catch (error) {
      this.log.error('Error sending CEC HDMI1 command:', error);
      return false;
    }
  }

  private cleanup() {
    // Nettoyer le watcher CEC externe
    if (this.externalCECWatcher) {
      clearInterval(this.externalCECWatcher);
      this.externalCECWatcher = null;
      this.log.info('CEC: Stopped external CEC service watcher');
    }
  }

  // Anciens callbacks CEC supprimés - maintenant gérés par le service externe
}
