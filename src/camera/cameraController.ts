import { execFile } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import axios from 'axios';
import { Logger } from 'homebridge';
import { CameraBackend, CameraRoi, IRAmplifierConfig } from '../types';

const execFileAsync = promisify(execFile);

const STILL_BINARIES = ['rpicam-still', 'libcamera-still', 'raspistill'];

export class CameraController {
  private stillBinary: string | null | undefined;
  private readonly snapshotDir: string;
  private readonly width: number;
  private readonly height: number;
  private readonly roi?: CameraRoi;
  private readonly backend: CameraBackend;
  private cameraMissingLogged = false;
  private cameraRetryAfter = 0;

  constructor(
    private readonly log: Logger,
    private readonly config: IRAmplifierConfig,
  ) {
    const ocr = config.ocr;
    this.backend = ocr?.backend ?? (ocr?.cameraUrl ? 'http' : 'rpicam');
    this.snapshotDir = ocr?.snapshotDir ?? '/var/lib/homebridge/ir-amplifier/camera';
    this.width = ocr?.width ?? 1920;
    this.height = ocr?.height ?? 672;
    this.roi = ocr?.roi;
    this.log.info(
      `[CAMERA] backend=${this.backend}, size=${this.width}x${this.height}` +
      (this.roi ? `, roi=${this.roi.x},${this.roi.y},${this.roi.width},${this.roi.height}` : '') +
      `, snapshots=${this.snapshotDir}`,
    );
  }

  lastSnapshotPath(): string {
    return join(this.snapshotDir, 'last.jpg');
  }

  async capture(): Promise<Buffer | null> {
    if (Date.now() < this.cameraRetryAfter) {
      return null;
    }

    try {
      const buffer = this.backend === 'http'
        ? await this.captureHttp()
        : await this.capturePiCamera();

      if (buffer) {
        this.saveDebugSnapshots(buffer);
      }
      return buffer;
    } catch (error) {
      this.handleCaptureError(error);
      return null;
    }
  }

  private handleCaptureError(error: unknown): void {
    const text = error instanceof Error
      ? `${error.message}\n${(error as Error & { stderr?: string }).stderr ?? ''}`
      : String(error);
    const noCamera = /no cameras available/i.test(text);

    if (noCamera) {
      this.cameraRetryAfter = Date.now() + 5 * 60 * 1000;
      if (!this.cameraMissingLogged) {
        this.cameraMissingLogged = true;
        this.log.error(
          '[CAMERA] rpicam-still ne voit aucune caméra CSI. ' +
          'Le process Homebridge n\'a pas les groupes video/render. ' +
          'À lancer une fois : sudo usermod -aG video,render homebridge && sudo hb-service restart',
        );
      }
      return;
    }

    this.log.error('[CAMERA] Capture failed:', error);
  }

  private async captureHttp(): Promise<Buffer | null> {
    const url = this.config.ocr?.cameraUrl;
    if (!url) {
      this.log.error('[CAMERA] cameraUrl manquant pour le backend http');
      return null;
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });
    return Buffer.from(response.data);
  }

  private async capturePiCamera(): Promise<Buffer | null> {
    const binary = await this.resolveStillBinary();
    if (!binary) {
      this.log.error('[CAMERA] Aucun outil de capture CSI trouvé (rpicam-still, libcamera-still, raspistill)');
      return null;
    }

    this.ensureSnapshotDir();
    const output = this.lastSnapshotPath();
    const args = this.buildStillArgs(binary, output);

    this.log.info(`[CAMERA] Capturing with ${binary} ${args.join(' ')}`);
    await execFileAsync(binary, args, { timeout: 15000 });

    if (!existsSync(output)) {
      this.log.error(`[CAMERA] Fichier non créé: ${output}`);
      return null;
    }

    return readFileSync(output);
  }

  private buildStillArgs(binary: string, output: string): string[] {
    const roi = this.roiToString();
    if (binary === 'raspistill') {
      return [
        '-n', '-t', '1000',
        '-w', String(this.width),
        '-h', String(this.height),
        '-q', '92',
        ...(roi ? ['-roi', roi] : []),
        '-o', output,
      ];
    }
    return [
      '--nopreview',
      '--timeout', '1000',
      '--width', String(this.width),
      '--height', String(this.height),
      '--quality', '92',
      '--encoding', 'jpg',
      ...(roi ? ['--roi', roi] : []),
      '--output', output,
    ];
  }

  private roiToString(): string | undefined {
    if (!this.roi) {
      return undefined;
    }
    return `${this.roi.x},${this.roi.y},${this.roi.width},${this.roi.height}`;
  }

  private async resolveStillBinary(): Promise<string | null> {
    if (this.stillBinary !== undefined) {
      return this.stillBinary;
    }

    for (const binary of STILL_BINARIES) {
      try {
        const { stdout } = await execFileAsync('which', [binary]);
        if (stdout.trim()) {
          this.stillBinary = binary;
          this.log.info(`[CAMERA] Outil CSI: ${binary}`);
          return binary;
        }
      } catch {
        // try next
      }
    }

    this.stillBinary = null;
    return null;
  }

  private saveDebugSnapshots(buffer: Buffer): void {
    if (this.config.ocr?.saveSnapshots === false) {
      return;
    }

    try {
      this.ensureSnapshotDir();
      const last = this.lastSnapshotPath();
      writeFileSync(last, buffer);

      if (this.config.ocr?.debugSnapshots) {
        const stamped = join(this.snapshotDir, `shot-${Date.now()}.jpg`);
        copyFileSync(last, stamped);
        this.log.info(`[CAMERA] Snapshot debug: ${stamped}`);
      } else {
        this.log.debug(`[CAMERA] Snapshot: ${last} (${buffer.length} bytes)`);
      }
    } catch (error) {
      this.log.warn('[CAMERA] Impossible d\'écrire le snapshot de debug:', error);
    }
  }

  private ensureSnapshotDir(): void {
    if (!existsSync(this.snapshotDir)) {
      mkdirSync(this.snapshotDir, { recursive: true });
    }
  }
}
