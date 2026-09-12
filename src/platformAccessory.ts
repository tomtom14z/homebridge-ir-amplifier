import { API, Characteristic, CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import { IRAmplifierPlatform } from './index';
import { TPLinkController } from './tplinkController';
import { OCRController, OCRResult } from './ocrController';
import { AmplifierState } from './state/amplifierState';
import { IrBackend } from './ir/irBackend';
import { initializeVolume, getStartupVolume } from './ir/volumeInit';
import {
  getTPLinkPowerOnDelay,
  isAutoHDMI1Enabled,
  isTPLinkPowerCheckEnabled,
} from './config/powerOn';
import { writeCecAudioStatus } from './cec/audioStatus';
import { IRAmplifierConfig } from './types';

export class IRAmplifierAccessory {
  private service: Service;
  private speakerService: Service;
  private volumeService: Service;

  private isSourceCorrect = false;
  private volumeSyncInProgress = false;
  
  // Gestion de l'état temporaire pour TP-Link
  private pendingStateChange = false;
  private lastStateChangeTime = 0;
  private stateChangeTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: IRAmplifierPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly ir: IrBackend,
    private readonly tplinkController: TPLinkController,
    private readonly ocrController: OCRController,
    private readonly state: AmplifierState,
    private readonly pluginConfig: IRAmplifierConfig,
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
    this.volumeService.setCharacteristic(this.Characteristic.Brightness, this.state.getEstimatedVolume());

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

  private publishPower(): void {
    this.service.updateCharacteristic(this.Characteristic.On, this.state.isOn());
  }

  private publishVolume(reportCec = false): void {
    const volume = this.state.getEstimatedVolume();
    this.speakerService.updateCharacteristic(this.Characteristic.Volume, volume);
    this.volumeService.updateCharacteristic(this.Characteristic.Brightness, volume);
    if (reportCec) {
      writeCecAudioStatus(this.log, this.state, this.pluginConfig);
    }
  }

  private async setPowerState(value: CharacteristicValue) {
    const boolValue = value as boolean;
    this.log.info('=== SET POWER STATE CALLED ===');
    this.log.info('Requested state:', boolValue);
    this.log.info('Current accessory state:', this.state.isOn());
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
      this.state.setPowerOn(boolValue, 'homekit');
      this.publishPower();
      this.log.info('HomeKit state set to temporary state:', this.state.isOn());
      
      // Envoyer la commande IR via Broadlink
      this.log.info('Sending IR command to change amplifier state');
      const success = boolValue 
        ? await this.handlePowerOnWithEnhancements()
        : await this.ir.send('powerOff');
      
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
        this.state.setPowerOn(currentTpLinkState, 'hs110');
        this.publishPower();
        this.pendingStateChange = false;
        this.log.info('State reverted due to IR command failure');
      }
    } else {
      this.log.info('No state change needed - already matches');
      // S'assurer que HomeKit reflète l'état réel
      this.state.setPowerOn(currentTpLinkState, 'hs110');
      this.publishPower();
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
      this.log.info('Current accessory state:', this.state.isOn());
      this.log.info('Pending state change:', this.pendingStateChange);
      
      // Vérifier l'état actuel de TP-Link
      const actualTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('TP-Link state after delay:', actualTpLinkState, 'Expected:', expectedState);
      
      if (actualTpLinkState === expectedState) {
        // L'état correspond, confirmer
        this.log.info('State change confirmed - TP-Link matches expected state');
        this.state.setPowerOn(actualTpLinkState, 'hs110');
        this.publishPower();
        this.log.info('HomeKit state confirmed to:', this.state.isOn());
        
        // Synchroniser l'état CEC avec l'état confirmé
        this.syncCECState(this.state.isOn());
      } else {
        // L'état ne correspond pas, corriger
        this.log.warn('State mismatch detected - TP-Link:', actualTpLinkState, 'Expected:', expectedState);
        this.log.info('Correcting HomeKit state to match TP-Link reality');
        
        this.state.setPowerOn(actualTpLinkState, 'hs110');
        this.publishPower();
        this.log.info('HomeKit state corrected to:', this.state.isOn());
        
        // Synchroniser l'état CEC avec l'état corrigé
        this.syncCECState(this.state.isOn());
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
    this.log.debug('TP-Link inUse:', inUse, 'Current accessory state:', this.state.isOn());
    
    // Ne pas mettre à jour l'état si un changement est en cours
    if (!this.pendingStateChange) {
      this.state.setPowerOn(inUse, 'hs110');
      this.log.debug('Accessory state updated to:', this.state.isOn());
    } else {
      this.log.debug('Skipping state update - pending state change in progress');
    }
    
    this.log.debug('Returning power state:', this.state.isOn());
    return this.state.isOn();
  }

  private async setVolume(value: CharacteristicValue) {
    const numValue = value as number;
    this.log.info('Setting volume to:', value);
    this.state.setRequestedVolume(numValue);
    
    if (this.volumeSyncInProgress) {
      this.log.debug('Volume sync in progress, skipping');
      return;
    }

    await this.syncVolumeToTarget();
    
    // CEC géré par le service externe - pas d'action nécessaire
    this.log.debug('Volume changed - CEC handled by external service');
  }

  private async getVolume(): Promise<number> {
    return this.state.getEstimatedVolume();
  }

  private async setVolumeBrightness(value: CharacteristicValue) {
    const numValue = value as number;
    // Map brightness (0-100) to volume (0-100)
    await this.setVolume(numValue);
  }

  private async getVolumeBrightness(): Promise<number> {
    return this.state.getEstimatedVolume();
  }

  private async syncVolumeToTarget() {
    if (this.volumeSyncInProgress) return;
    
    this.volumeSyncInProgress = true;
    this.log.info('Syncing volume from', this.state.getEstimatedVolume(), 'to', this.state.getRequestedVolume());

    try {
      const difference = this.state.getRequestedVolume() - this.state.getEstimatedVolume();
      const steps = Math.abs(difference);
      
      for (let i = 0; i < steps; i++) {
        if (difference > 0) {
          await this.ir.send('volumeUp');
          this.state.adjustEstimatedVolume(1);
        } else {
          await this.ir.send('volumeDown');
          this.state.adjustEstimatedVolume(-1);
        }
        
        this.publishVolume();
        this.ocrController.scheduleAfterVolumeBurst();
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      this.log.info('Volume sync completed. Current volume:', this.state.getEstimatedVolume());
      writeCecAudioStatus(this.log, this.state, this.pluginConfig);
    } catch (error) {
      this.log.error('Error during volume sync:', error);
    } finally {
      this.volumeSyncInProgress = false;
    }
  }

  private async applyOcrResult(result: OCRResult) {
    try {
      if (result.volume !== null && result.confidence > 0.7) {
        const ocrVolume = result.volume;
        const difference = Math.abs(ocrVolume - this.state.getEstimatedVolume());

        if (difference > 0) {
          this.log.info('[OCR] Volume recalé:', this.state.getEstimatedVolume(), '→', ocrVolume);
          this.state.confirmVolume(ocrVolume, result.confidence);
          this.publishVolume(true);
        }
      }

      if (result.source !== null) {
        const isVideo2 = result.source.toLowerCase().includes('video 2') ||
                        result.source.toLowerCase().includes('video2');
        this.isSourceCorrect = isVideo2;

        if (!isVideo2) {
          this.log.warn('Source is not VIDEO 2. Current source:', result.source);
        }
      }
    } catch (error) {
      this.log.error('Error applying OCR result:', error);
    }
  }

  private initializeMonitoring() {
    // Monitor TP-Link power state
    this.tplinkController.startPowerMonitoring(async (inUse: boolean) => {
      this.log.debug('=== TP-LINK MONITORING CALLBACK ===');
      this.log.debug('TP-Link inUse:', inUse, 'Accessory state:', this.state.isOn());
      this.log.debug('Pending state change:', this.pendingStateChange);
      
      if (inUse !== this.state.isOn()) {
        this.log.info('TP-Link: Power state changed:', this.state.isOn(), '→', inUse);
        
        // Ne pas interférer si un changement d'état est en cours
        if (this.pendingStateChange) {
          this.log.info('TP-Link: Ignoring state change - pending state change in progress');
          return;
        }
        
        this.state.setPowerOn(inUse, 'hs110');
        this.publishPower();
        this.log.info('TP-Link: Updated HomeKit power state to:', this.state.isOn());
        
        // Délai avant de synchroniser CEC pour éviter les conflits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Synchroniser l'état CEC avec TP-Link (local seulement)
        this.log.debug('TP-Link: CEC state synchronized locally with TP-Link:', this.state.isOn());
      } else {
        this.log.debug('TP-Link: No state change needed');
        
        // Même si pas de changement d'état, s'assurer que CEC est synchronisé localement
        this.log.debug('TP-Link: CEC state synchronized locally with current state:', this.state.isOn());
      }
    });

    this.ocrController.onCaptureResult((result: OCRResult) => {
      void this.applyOcrResult(result);
    });
    this.ocrController.startPeriodicCheck((result: OCRResult) => {
      void this.applyOcrResult(result);
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
        this.log.debug('Current accessory state:', this.state.isOn());
        
        // Ne pas vérifier si un changement d'état est en cours
        if (this.pendingStateChange) {
          this.log.debug('Skipping periodic verification - state change in progress');
          return;
        }
        
        const tpLinkState = await this.tplinkController.getInUseState();
        this.log.debug('TP-Link state:', tpLinkState, 'Accessory state:', this.state.isOn());
        
        if (tpLinkState !== this.state.isOn()) {
          this.log.info('Periodic check - State mismatch detected - TP-Link:', tpLinkState, 'Accessory:', this.state.isOn());
          this.log.info('Correcting accessory state to match TP-Link');
          
          this.state.setPowerOn(tpLinkState, 'hs110');
          this.publishPower();
          this.log.info('Accessory state corrected to:', this.state.isOn());
          
          this.log.debug('CEC: State corrected locally:', this.state.isOn());
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
      this.state.setPowerOn(tpLinkState, 'hs110');
      this.log.info('Accessory state synchronized with TP-Link:', this.state.isOn());
      
      this.publishPower();
      this.log.info('HomeKit state updated to real TP-Link state:', this.state.isOn());
      
      // CEC géré par le service externe
      this.log.info('CEC handled by external service - no internal CEC state');
      
      // Délai avant la synchronisation initiale CEC
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Synchroniser l'état CEC avec l'état initial
      this.syncCECState(this.state.isOn());
      this.log.info('CEC: Initial state synchronized with CEC bus');
      
      await this.getVolume();
      
      this.log.info('State synchronization completed - Accessory:', this.state.isOn(), 'TP-Link:', tpLinkState, 'CEC: external service');
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
      if (isAutoHDMI1Enabled(this.pluginConfig)) {
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
    this.log.info('CEC: Power enhancements config - autoHDMI1:', isAutoHDMI1Enabled(this.pluginConfig));
    this.log.info('CEC: Power enhancements config - tplinkPowerCheck:', isTPLinkPowerCheckEnabled(this.pluginConfig));
    this.log.info('CEC: Power enhancements config - tplinkPowerOnDelay:', getTPLinkPowerOnDelay(this.pluginConfig));
    
    // Utiliser la méthode helper pour gérer l'allumage avec les améliorations
    const success = await this.handlePowerOnWithEnhancements();
    
    if (success) {
      this.log.info('CEC: Power ON command sent successfully');
      
      // Envoyer immédiatement la commande HDMI1 en parallèle (la TV gère les commandes CEC en arrière-plan pendant qu'elle s'allume)
      if (isAutoHDMI1Enabled(this.pluginConfig)) {
        this.log.info('CEC: Sending HDMI1 command immediately via CEC...');
        // Ne pas attendre (fire and forget) pour ne pas bloquer l'initialisation du volume
        this.sendCECHdmi1Command().then(hdmiSuccess => {
          if (hdmiSuccess) {
            this.log.info('CEC: HDMI1 CEC command sent successfully');
          } else {
            this.log.warn('CEC: HDMI1 CEC command failed');
          }
        });
      }
      
      // 4. Attendre un peu pour que la commande IR prenne effet
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 5. Vérifier le nouvel état TP-Link
      const newTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('CEC: After IR command - TP-Link state:', newTpLinkState);
      
      // 6. Mettre à jour l'état local et HomeKit
      this.state.setPowerOn(newTpLinkState, 'hs110');
      this.publishPower();
      this.log.info('CEC: Updated HomeKit power state to:', this.state.isOn());
      
        if (this.state.isOn()) {
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
    const success = await this.ir.send('powerOff');
    
    if (success) {
      this.log.info('CEC: Power OFF command sent successfully');
      
      // Attendre un peu pour que la commande IR prenne effet
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Vérifier le nouvel état TP-Link
      const newTpLinkState = await this.tplinkController.getInUseState();
      this.log.info('CEC: After IR command - TP-Link state:', newTpLinkState);
      
      // Mettre à jour l'état local et HomeKit
      this.state.setPowerOn(newTpLinkState, 'hs110');
      this.publishPower();
      this.log.info('CEC: Updated HomeKit power state to:', this.state.isOn());
    } else {
      this.log.error('CEC: Failed to send power OFF command');
    }
  }

  private async handleCECVolumeUp() {
    this.log.info('CEC: Volume UP requested - sending IR volume up command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.ir.send('volumeUp');
    
    if (success) {
      this.state.adjustEstimatedVolume(1);
      this.publishVolume(true);
      this.ocrController.scheduleAfterVolumeBurst();
      this.log.info('CEC: Volume UP command sent successfully, volume now:', this.state.getEstimatedVolume());
    } else {
      this.log.error('CEC: Failed to send volume UP command');
    }
  }

  private async handleCECVolumeDown() {
    this.log.info('CEC: Volume DOWN requested - sending IR volume down command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.ir.send('volumeDown');
    
    if (success) {
      this.state.adjustEstimatedVolume(-1);
      this.publishVolume(true);
      this.ocrController.scheduleAfterVolumeBurst();
      this.log.info('CEC: Volume DOWN command sent successfully, volume now:', this.state.getEstimatedVolume());
    } else {
      this.log.error('CEC: Failed to send volume DOWN command');
    }
  }

  private async handleCECMuteToggle() {
    this.log.info('CEC: Mute toggle requested - sending IR mute command');
    
    // Envoyer directement la commande IR (les callbacks onSet ne sont pas déclenchés depuis le code)
    const success = await this.ir.send('mute');
    
    if (success) {
      const nextVolume = this.state.getEstimatedVolume() === 0 ? 50 : 0;
      this.state.setMuted(nextVolume === 0);
      this.state.setEstimatedVolume(nextVolume, 'mute toggle');
      this.publishVolume(true);
      this.ocrController.scheduleAfterVolumeBurst();
      this.log.info('CEC: Mute command sent successfully, volume now:', this.state.getEstimatedVolume());
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
      const success = await initializeVolume(this.ir, this.pluginConfig, this.log);
      
      if (success) {
        this.log.info('Volume initialization completed successfully');
        
        const startupVolume = getStartupVolume(this.pluginConfig);
        this.state.setEstimatedVolume(startupVolume, 'startup');
        this.publishVolume(true);
        this.log.info(`HomeKit volume updated to startup volume: ${startupVolume}%`);
        this.ocrController.scheduleAfterVolumeBurst();
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
    if (isTPLinkPowerCheckEnabled(this.pluginConfig)) {
      this.log.info('handlePowerOnWithEnhancements: TP-Link power check is ENABLED');
      this.log.info('Checking TP-Link plug power state...');
      
      // Vérifier l'état actuel avant d'appeler ensurePlugIsOn
      const currentState = await this.tplinkController.getInUseState();
      const plugReady = await this.tplinkController.ensurePlugIsOn();
      
      if (!plugReady) {
        this.log.error('Failed to ensure TP-Link plug is ON - aborting power on');
        return false;
      }
      
      // Attendre le délai configuré SEULEMENT si la prise était OFF et a été allumée
      if (!currentState) {
        const delay = getTPLinkPowerOnDelay(this.pluginConfig);
        this.log.info(`TP-Link plug was OFF and turned ON - waiting ${delay} seconds for stabilization...`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      } else {
        this.log.info('TP-Link plug was already ON - no delay needed, proceeding immediately');
      }
    } else {
      this.log.info('handlePowerOnWithEnhancements: TP-Link power check is DISABLED');
    }
    
    // 2. Envoyer la commande IR d'allumage
    this.log.info('handlePowerOnWithEnhancements: Sending IR power command to turn ON amplifier');
    const success = await this.ir.send('powerOn');
    
    if (success) {
      this.log.info('handlePowerOnWithEnhancements: IR power command sent successfully');
      
        // 3. Envoyer la commande HDMI1 via CEC si activée
        if (isAutoHDMI1Enabled(this.pluginConfig)) {
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
      this.log.info('Sending HDMI1 command via external CEC service...');
      
      // Utiliser le service CEC externe via le fichier de communication
      const cecCommand = {
        action: 'hdmi1',
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      const fs = require('fs');
      const path = '/var/lib/homebridge/homebridge-to-cec.json';
      
      // Écrire la commande HDMI1 dans le fichier de communication
      fs.writeFileSync(path, JSON.stringify(cecCommand));
      this.log.info('HDMI1 command written to CEC communication file');
      
      // Attendre un peu pour que le service CEC traite la commande
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.log.info('HDMI1 command sent via external CEC service');
      return true;
      
    } catch (error) {
      this.log.error('Error sending HDMI1 command via external CEC service:', error);
      return false;
    }
  }

  /**
   * Try a specific CEC command
   */
  private async tryCECCommand(command: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const cecProcess = spawn('cec-ctl', command);

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
          this.log.info('CEC command succeeded');
          this.log.debug('CEC output:', output);
          resolve(true);
        } else {
          this.log.warn(`CEC command failed with code: ${code}`);
          this.log.debug('CEC error:', errorOutput);
          resolve(false);
        }
      });

      cecProcess.on('error', (error: Error) => {
        this.log.warn('Failed to execute CEC command:', error);
        resolve(false);
      });
    });
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
