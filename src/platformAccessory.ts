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
        ? await this.broadlinkController.powerOn()
        : await this.broadlinkController.powerOff();
      
      if (success) {
        this.log.info('IR command sent successfully, scheduling verification');
        // Synchroniser l'état CEC avec le nouvel état
        this.syncCECState(boolValue);
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
              } else if (command.value === 'off') {
                this.log.info('CEC: Power OFF from external service');
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
    this.log.info('CEC: Apple TV requested amplifier ON - updating HomeKit state to trigger IR command');
    
    // Mettre à jour l'état HomeKit (cela déclenchera setPowerState qui enverra la commande IR)
    this.isOn = true;
    this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
    this.log.info('CEC: HomeKit power state updated to ON - this will trigger IR command via setPowerState callback');
  }

  private async handleCECPowerOff() {
    this.log.info('CEC: Apple TV requested amplifier OFF - updating HomeKit state to trigger IR command');
    
    // Mettre à jour l'état HomeKit (cela déclenchera setPowerState qui enverra la commande IR)
    this.isOn = false;
    this.service.updateCharacteristic(this.Characteristic.On, this.isOn);
    this.log.info('CEC: HomeKit power state updated to OFF - this will trigger IR command via setPowerState callback');
  }

  private async handleCECVolumeUp() {
    this.log.info('CEC: Volume UP requested - updating HomeKit volume to trigger IR command');
    
    // Mettre à jour le volume HomeKit (cela déclenchera setVolume qui enverra la commande IR)
    this.currentVolume = Math.min(100, this.currentVolume + 1);
    this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
    this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
    this.log.info('CEC: HomeKit volume updated to:', this.currentVolume, '- this will trigger IR command via setVolume callback');
  }

  private async handleCECVolumeDown() {
    this.log.info('CEC: Volume DOWN requested - updating HomeKit volume to trigger IR command');
    
    // Mettre à jour le volume HomeKit (cela déclenchera setVolume qui enverra la commande IR)
    this.currentVolume = Math.max(0, this.currentVolume - 1);
    this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
    this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
    this.log.info('CEC: HomeKit volume updated to:', this.currentVolume, '- this will trigger IR command via setVolume callback');
  }

  private async handleCECMuteToggle() {
    this.log.info('CEC: Mute toggle requested - updating HomeKit volume to trigger IR command');
    
    // Basculer l'état mute dans HomeKit (cela déclenchera setVolume qui enverra la commande IR)
    this.currentVolume = this.currentVolume === 0 ? 50 : 0; // Toggle entre 0 et 50
    this.speakerService.updateCharacteristic(this.Characteristic.Volume, this.currentVolume);
    this.volumeService.updateCharacteristic(this.Characteristic.Brightness, this.currentVolume);
    this.log.info('CEC: HomeKit volume toggled to:', this.currentVolume, '- this will trigger IR command via setVolume callback');
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
