/**
 * WASM JPEG Encoder with chunked output draining.
 */

import type { Scanline } from '../types';
import type { SipWasmModule } from './types';
import { copyFromWasm, getWasmModule } from './loader';

export class WasmJpegEncoder {
  private readonly module: SipWasmModule;
  private encoder = 0;
  private width = 0;
  private height = 0;
  private rowBufferPtr = 0;
  private started = false;
  private finished = false;
  private currentLine = 0;

  constructor() {
    this.module = getWasmModule();
    this.encoder = this.module._sip_encoder_create();
    if (!this.encoder) {
      throw new Error('Failed to create JPEG encoder');
    }
  }

  init(width: number, height: number, quality = 85): void {
    this.width = width;
    this.height = height;

    if (this.module._sip_encoder_init(this.encoder, width, height, quality) !== 0) {
      throw new Error('Failed to initialize JPEG encoder');
    }
  }

  start(): void {
    if (this.started) {
      return;
    }

    if (this.module._sip_encoder_start(this.encoder) !== 0) {
      throw new Error('Failed to start JPEG compression');
    }

    this.rowBufferPtr = this.module._sip_encoder_get_row_buffer(this.encoder);
    if (!this.rowBufferPtr) {
      throw new Error('Failed to get JPEG encoder row buffer');
    }

    this.started = true;
    this.currentLine = 0;
  }

  writeScanline(scanline: Scanline): void {
    this.writeScanlineData(scanline.data);
  }

  writeScanlineData(data: Uint8Array): void {
    if (!this.started || this.finished) {
      throw new Error('Encoder is not ready for scanlines');
    }

    const expectedSize = this.width * 3;
    if (data.byteLength !== expectedSize) {
      throw new Error(`Invalid scanline size: expected ${expectedSize}, got ${data.byteLength}`);
    }

    this.module.HEAPU8.set(data, this.rowBufferPtr);
    if (this.module._sip_encoder_write_scanline(this.encoder) !== 1) {
      throw new Error('Failed to write JPEG scanline');
    }

    this.currentLine++;
  }

  drainChunks(): Uint8Array[] {
    const chunks: Uint8Array[] = [];

    while (true) {
      const ptr = this.module._sip_encoder_peek_chunk_data(this.encoder);
      const size = this.module._sip_encoder_peek_chunk_size(this.encoder);
      if (!ptr || !size) {
        break;
      }

      chunks.push(copyFromWasm(this.module, ptr, size));
      this.module._sip_encoder_pop_chunk(this.encoder);
    }

    return chunks;
  }

  finish(): Uint8Array[] {
    if (!this.started) {
      throw new Error('Encoding not started');
    }
    if (this.finished) {
      return [];
    }
    if (this.currentLine !== this.height) {
      throw new Error(`Incomplete image: wrote ${this.currentLine}/${this.height} scanlines`);
    }

    if (this.module._sip_encoder_finish(this.encoder) !== 0) {
      throw new Error('Failed to finish JPEG compression');
    }

    this.finished = true;
    return this.drainChunks();
  }

  encodeAll(pixels: Uint8Array): ArrayBuffer {
    this.start();

    const rowSize = this.width * 3;
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (let y = 0; y < this.height; y++) {
      this.writeScanlineData(pixels.subarray(y * rowSize, (y + 1) * rowSize));
      for (const chunk of this.drainChunks()) {
        chunks.push(chunk);
        total += chunk.byteLength;
      }
    }

    for (const chunk of this.finish()) {
      chunks.push(chunk);
      total += chunk.byteLength;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
  }

  getBufferedOutputSize(): number {
    return this.module._sip_encoder_get_buffered_output_size(this.encoder);
  }

  getRowBufferSize(): number {
    return this.width * 3;
  }

  getCurrentLine(): number {
    return this.currentLine;
  }

  dispose(): void {
    if (this.encoder) {
      this.module._sip_encoder_destroy(this.encoder);
      this.encoder = 0;
    }

    this.rowBufferPtr = 0;
    this.started = false;
    this.finished = false;
    this.currentLine = 0;
  }
}

