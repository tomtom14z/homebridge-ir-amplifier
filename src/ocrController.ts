import { Logger } from 'homebridge';
import { CameraController } from './camera/cameraController';
import { IRAmplifierConfig } from './types';
// @ts-ignore
import * as cron from 'node-cron';
import { createWorker } from 'tesseract.js';

export interface OCRResult {
  volume: number | null;
  source: string | null;
  confidence: number;
}

export class OCRController {
  private worker: any;
  private isInitialized = false;
  private readonly camera?: CameraController;
  private captureTimer: NodeJS.Timeout | null = null;
  private capturing = false;
  private onResult?: (result: OCRResult) => void;

  constructor(
    private log: Logger,
    private config: IRAmplifierConfig,
  ) {
    this.camera = this.config.ocr ? new CameraController(this.log, this.config) : undefined;
    if (this.config.ocr?.recognize) {
      this.initializeWorker();
    } else if (this.camera) {
      this.log.info('[CAMERA] Capture après rafale volume — pas de reconnaissance continue');
    } else {
      this.log.info('OCR/camera disabled in configuration');
    }
  }

  onCaptureResult(callback: (result: OCRResult) => void): void {
    this.onResult = callback;
  }

  /**
   * Reset a timer on each volume IR. Capture only after the sequence has settled
   * so VOLUME is still on the VFD (~2s window) without blocking commands.
   */
  scheduleAfterVolumeBurst(): void {
    const delayMs = this.config.ocr?.captureAfterVolumeMs ?? 400;
    if (delayMs <= 0 || !this.camera) {
      return;
    }

    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
    }

    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;
      void this.runSettledCapture('volume');
    }, delayMs);
  }

  async captureNow(reason: string): Promise<void> {
    await this.runSettledCapture(reason);
  }

  private async runSettledCapture(reason: string): Promise<void> {
    if (!this.camera || this.capturing) {
      return;
    }

    this.capturing = true;
    const frames = Math.max(1, this.config.ocr?.captureFrames ?? 2);
    const gapMs = this.config.ocr?.captureFrameGapMs ?? 120;
    this.log.info(`[CAMERA] Capturing after ${reason} idle (${frames} frame(s))`);

    try {
      for (let i = 0; i < frames; i++) {
        const imageBuffer = await this.camera.capture();
        if (imageBuffer && this.config.ocr?.recognize) {
          const result = await this.processImage(imageBuffer);
          this.onResult?.(result);
        }
        if (i < frames - 1) {
          await new Promise(resolve => setTimeout(resolve, gapMs));
        }
      }
    } catch (error) {
      this.log.error('[CAMERA] Settled capture failed:', error);
    } finally {
      this.capturing = false;
    }
  }

  private async initializeWorker() {
    try {
      this.worker = await createWorker({
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            this.log.debug('OCR progress:', Math.round(m.progress * 100) + '%');
          }
        },
      });

      await this.worker.loadLanguage('eng');
      await this.worker.initialize('eng');

      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz: -',
        tessedit_pageseg_mode: '8',
      });

      this.isInitialized = true;
      this.log.info('OCR worker initialized');
    } catch (error) {
      this.log.error('Failed to initialize OCR worker:', error);
      this.isInitialized = false;
    }
  }

  async captureScreen(): Promise<Buffer | null> {
    if (!this.camera) {
      return null;
    }
    return this.camera.capture();
  }

  async extractVolumeFromText(text: string): Promise<number | null> {
    const volumePatterns = [
      /vol[ume]*\s*:?\s*(\d+)/i,
      /(\d+)\s*%/,
      /volume\s*(\d+)/i,
    ];

    for (const pattern of volumePatterns) {
      const match = text.match(pattern);
      if (match) {
        const volume = parseInt(match[1], 10);
        if (volume >= 0 && volume <= 100) {
          return volume;
        }
      }
    }

    return null;
  }

  async extractSourceFromText(text: string): Promise<string | null> {
    const sourcePatterns = [
      /source\s*:?\s*([a-zA-Z0-9\s]+)/i,
      /input\s*:?\s*([a-zA-Z0-9\s]+)/i,
      /video\s*(\d+)/i,
    ];

    for (const pattern of sourcePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  async processImage(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.isInitialized || !this.worker) {
      return { volume: null, source: null, confidence: 0 };
    }

    try {
      const { data: { text, confidence } } = await this.worker.recognize(imageBuffer);
      this.log.debug('OCR Text:', text);
      this.log.debug('OCR Confidence:', confidence);

      return {
        volume: await this.extractVolumeFromText(text),
        source: await this.extractSourceFromText(text),
        confidence: confidence / 100,
      };
    } catch (error) {
      this.log.error('OCR processing failed:', error);
      return { volume: null, source: null, confidence: 0 };
    }
  }

  async getVolumeAndSource(): Promise<OCRResult> {
    if (!this.config.ocr?.recognize) {
      return { volume: null, source: null, confidence: 0 };
    }

    const imageBuffer = await this.captureScreen();
    if (!imageBuffer) {
      return { volume: null, source: null, confidence: 0 };
    }

    return this.processImage(imageBuffer);
  }

  startPeriodicCheck(callback: (result: OCRResult) => void) {
    if (!this.config.ocr?.periodic) {
      this.log.info('[CAMERA] Periodic capture disabled (event-driven only)');
      return;
    }

    const interval = this.config.ocr.checkInterval || 30000;
    cron.schedule(`*/${Math.floor(interval / 1000)} * * * * *`, async () => {
      try {
        const result = await this.getVolumeAndSource();
        if (result.volume !== null || result.source !== null) {
          callback(result);
        }
      } catch (error) {
        this.log.error('Error in periodic OCR check:', error);
      }
    });
  }

  async terminate() {
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.worker) {
      await this.worker.terminate();
      this.log.info('OCR worker terminated');
    }
  }
}
