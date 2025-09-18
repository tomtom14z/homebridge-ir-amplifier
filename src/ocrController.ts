import { Logger } from 'homebridge';
import { createWorker } from 'tesseract.js';
import axios from 'axios';
import * as cron from 'node-cron';

export interface OCRResult {
  volume: number | null;
  source: string | null;
  confidence: number;
}

export class OCRController {
  private worker: any;
  private isInitialized = false;

  constructor(
    private log: Logger,
    private config: any,
  ) {
    this.initializeWorker();
  }

  private async initializeWorker() {
    try {
      this.worker = await createWorker('eng');
      await this.worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz: -',
        tessedit_pageseg_mode: '8', // Single word
      });
      this.isInitialized = true;
      this.log.info('OCR worker initialized');
    } catch (error) {
      this.log.error('Failed to initialize OCR worker:', error);
    }
  }

  async captureScreen(): Promise<Buffer | null> {
    try {
      const response = await axios.get(this.config.ocr.cameraUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      this.log.error('Failed to capture screen:', error);
      return null;
    }
  }

  async extractVolumeFromText(text: string): Promise<number | null> {
    // Look for volume patterns like "VOL: 45", "Volume 45", "45%", etc.
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
    // Look for source patterns
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
      this.log.error('OCR worker not initialized');
      return { volume: null, source: null, confidence: 0 };
    }

    try {
      const { data: { text, confidence } } = await this.worker.recognize(imageBuffer);
      
      this.log.debug('OCR Text:', text);
      this.log.debug('OCR Confidence:', confidence);

      const volume = await this.extractVolumeFromText(text);
      const source = await this.extractSourceFromText(text);

      return {
        volume,
        source,
        confidence: confidence / 100, // Convert to 0-1 scale
      };
    } catch (error) {
      this.log.error('OCR processing failed:', error);
      return { volume: null, source: null, confidence: 0 };
    }
  }

  async getVolumeAndSource(): Promise<OCRResult> {
    const imageBuffer = await this.captureScreen();
    if (!imageBuffer) {
      return { volume: null, source: null, confidence: 0 };
    }

    return this.processImage(imageBuffer);
  }

  // Method to start periodic OCR checking
  startPeriodicCheck(callback: (result: OCRResult) => void) {
    const interval = this.config.ocr.checkInterval || 30000; // Default 30 seconds
    
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
    if (this.worker) {
      await this.worker.terminate();
      this.log.info('OCR worker terminated');
    }
  }
}
