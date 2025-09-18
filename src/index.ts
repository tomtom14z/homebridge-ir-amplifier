import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { IRAmplifierAccessory } from './platformAccessory';
import { BroadlinkController } from './broadlinkController';
import { TPLinkController } from './tplinkController';
import { OCRController } from './ocrController';
import { CECController } from './cecController';

export class IRAmplifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private broadlinkController: BroadlinkController;
  private tplinkController: TPLinkController;
  private ocrController: OCRController;
  private cecController: CECController;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // Initialize controllers
    this.broadlinkController = new BroadlinkController(this.log, this.config);
    this.tplinkController = new TPLinkController(this.log, this.config);
    this.ocrController = new OCRController(this.log, this.config);
    this.cecController = new CECController(this.log, this.config.cec);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    // Create the amplifier accessory
    const uuid = this.api.hap.uuid.generate('ir-amplifier');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new IRAmplifierAccessory(this, existingAccessory, this.broadlinkController, this.tplinkController, this.ocrController, this.cecController);
    } else {
      this.log.info('Adding new accessory: IR Amplifier');
      const accessory = new this.api.platformAccessory('IR Amplifier', uuid);
      accessory.context.device = {
        name: 'IR Amplifier',
        model: 'IR Amplifier',
        serialNumber: 'IR-AMP-001',
      };

      new IRAmplifierAccessory(this, accessory, this.broadlinkController, this.tplinkController, this.ocrController, this.cecController);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}
