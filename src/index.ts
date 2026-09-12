import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { IRAmplifierAccessory } from './platformAccessory';
import { TPLinkController } from './tplinkController';
import { OCRController } from './ocrController';
import { AmplifierState } from './state/amplifierState';
import { createIrBackend } from './ir/createIrBackend';
import { IRAmplifierConfig } from './types';

export class IRAmplifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  private tplinkController: TPLinkController;
  private ocrController: OCRController;
  private amplifierState: AmplifierState;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    const pluginConfig = this.config as unknown as IRAmplifierConfig;
    this.tplinkController = new TPLinkController(this.log, this.config as any);
    this.ocrController = new OCRController(this.log, this.config as any);
    this.amplifierState = new AmplifierState(this.log);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices(pluginConfig);
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices(pluginConfig: IRAmplifierConfig) {
    const irBackend = createIrBackend(this.log, pluginConfig);
    const uuid = this.api.hap.uuid.generate('ir-amplifier');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new IRAmplifierAccessory(
        this,
        existingAccessory,
        irBackend,
        this.tplinkController,
        this.ocrController,
        this.amplifierState,
        pluginConfig,
      );
    } else {
      this.log.info('Adding new accessory: IR Amplifier');
      const accessory = new this.api.platformAccessory('IR Amplifier', uuid);
      accessory.context.device = {
        name: 'IR Amplifier',
        model: 'IR Amplifier',
        serialNumber: 'IR-AMP-001',
      };

      new IRAmplifierAccessory(
        this,
        accessory,
        irBackend,
        this.tplinkController,
        this.ocrController,
        this.amplifierState,
        pluginConfig,
      );
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}

module.exports = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, IRAmplifierPlatform);
};
