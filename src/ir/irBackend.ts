import { IrCommandName } from './irCommands';

export interface IrBackend {
  readonly name: string;
  isReady(): boolean;
  send(command: IrCommandName): Promise<boolean>;
}

export interface IrBackendOptions {
  repeatCount?: number;
  holdMs?: number;
}
