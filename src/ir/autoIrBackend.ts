import { Logger } from 'homebridge';
import { IrBackend } from './irBackend';
import { IrCommandName } from './irCommands';

export class AutoIrBackend implements IrBackend {
  readonly name = 'auto';

  constructor(
    private readonly log: Logger,
    private readonly primary: IrBackend,
    private readonly fallback: IrBackend,
  ) {
    this.log.info(`[IR] Backend auto — primaire=${primary.name}, fallback=${fallback.name}`);
  }

  isReady(): boolean {
    return this.primary.isReady() || this.fallback.isReady();
  }

  async send(command: IrCommandName): Promise<boolean> {
    if (this.primary.isReady()) {
      const ok = await this.primary.send(command);
      if (ok) {
        return true;
      }
      this.log.warn(`[IR] ${this.primary.name} a échoué, fallback ${this.fallback.name}`);
    } else {
      this.log.debug(`[IR] ${this.primary.name} pas prêt, utilisation de ${this.fallback.name}`);
    }

    return this.fallback.send(command);
  }
}
