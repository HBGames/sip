// src/probe.ts
var MAGIC = {
  // JPEG: FFD8FF
  JPEG: [255, 216, 255],
  // PNG: 89504E47 0D0A1A0A
  PNG: [137, 80, 78, 71, 13, 10, 26, 10],
  // WebP: RIFF....WEBP
  RIFF: [82, 73, 70, 70],
  // "RIFF"
  WEBP: [87, 69, 66, 80],
  // "WEBP"
  // AVIF: ....ftypavif or ....ftypavis
  FTYP: [102, 116, 121, 112]
  // "ftyp"
};
function detectFormat(data) {
  if (data.length < 12) return "unknown";
  if (data[0] === MAGIC.JPEG[0] && data[1] === MAGIC.JPEG[1] && data[2] === MAGIC.JPEG[2]) {
    return "jpeg";
  }
  if (data[0] === MAGIC.PNG[0] && data[1] === MAGIC.PNG[1] && data[2] === MAGIC.PNG[2] && data[3] === MAGIC.PNG[3] && data[4] === MAGIC.PNG[4] && data[5] === MAGIC.PNG[5] && data[6] === MAGIC.PNG[6] && data[7] === MAGIC.PNG[7]) {
    return "png";
  }
  if (data[0] === MAGIC.RIFF[0] && data[1] === MAGIC.RIFF[1] && data[2] === MAGIC.RIFF[2] && data[3] === MAGIC.RIFF[3] && data[8] === MAGIC.WEBP[0] && data[9] === MAGIC.WEBP[1] && data[10] === MAGIC.WEBP[2] && data[11] === MAGIC.WEBP[3]) {
    return "webp";
  }
  if (data[4] === MAGIC.FTYP[0] && data[5] === MAGIC.FTYP[1] && data[6] === MAGIC.FTYP[2] && data[7] === MAGIC.FTYP[3]) {
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11]);
    if (brand === "avif" || brand === "avis" || brand === "mif1" || brand === "msf1") {
      return "avif";
    }
  }
  return "unknown";
}
function probeJpeg(data) {
  let offset = 2;
  while (offset < data.length - 1) {
    if (data[offset] !== 255) {
      offset++;
      continue;
    }
    while (offset < data.length && data[offset] === 255) {
      offset++;
    }
    if (offset >= data.length) break;
    const marker = data[offset++];
    const isSOF = marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207;
    if (isSOF) {
      if (offset + 7 > data.length) return null;
      const height = data[offset + 3] << 8 | data[offset + 4];
      const width = data[offset + 5] << 8 | data[offset + 6];
      return { width, height };
    }
    if (marker === 216 || marker === 217 || marker >= 208 && marker <= 215) {
      continue;
    }
    if (offset + 1 >= data.length) break;
    const segmentLength = data[offset] << 8 | data[offset + 1];
    offset += segmentLength;
  }
  return null;
}
function probePng(data) {
  if (data.length < 24) return null;
  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunkType !== "IHDR") return null;
  const width = data[16] << 24 | data[17] << 16 | data[18] << 8 | data[19];
  const height = data[20] << 24 | data[21] << 16 | data[22] << 8 | data[23];
  const colorType = data[25];
  const hasAlpha = colorType === 4 || colorType === 6;
  return { width, height, hasAlpha };
}
function probeWebp(data) {
  if (data.length < 30) return null;
  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunkType === "VP8 ") {
    if (data.length < 30) return null;
    if (data[23] !== 157 || data[24] !== 1 || data[25] !== 42) return null;
    const width = (data[26] | data[27] << 8) & 16383;
    const height = (data[28] | data[29] << 8) & 16383;
    return { width, height, hasAlpha: false };
  }
  if (chunkType === "VP8L") {
    if (data[20] !== 47) return null;
    const bits = data[21] | data[22] << 8 | data[23] << 16 | data[24] << 24;
    const width = (bits & 16383) + 1;
    const height = (bits >> 14 & 16383) + 1;
    const hasAlpha = (bits >> 28 & 1) === 1;
    return { width, height, hasAlpha };
  }
  if (chunkType === "VP8X") {
    const flags = data[20];
    const hasAlpha = (flags & 16) !== 0;
    const width = (data[24] | data[25] << 8 | data[26] << 16) + 1;
    const height = (data[27] | data[28] << 8 | data[29] << 16) + 1;
    return { width, height, hasAlpha };
  }
  return null;
}
function probeAvif(data) {
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3];
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7]
    );
    if (size === 0) break;
    if (size < 8) break;
    if (type === "ispe" && offset + 20 <= data.length) {
      const width = data[offset + 12] << 24 | data[offset + 13] << 16 | data[offset + 14] << 8 | data[offset + 15];
      const height = data[offset + 16] << 24 | data[offset + 17] << 16 | data[offset + 18] << 8 | data[offset + 19];
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    if (type === "meta" || type === "iprp" || type === "ipco") {
      const headerSize = type === "meta" ? 12 : 8;
      offset += headerSize;
      continue;
    }
    offset += size;
  }
  return null;
}
function probe(input) {
  const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const format = detectFormat(data);
  let result = null;
  switch (format) {
    case "jpeg":
      result = probeJpeg(data);
      break;
    case "png":
      result = probePng(data);
      break;
    case "webp":
      result = probeWebp(data);
      break;
    case "avif":
      result = probeAvif(data);
      break;
  }
  if (!result) {
    return {
      format: "unknown",
      width: 0,
      height: 0,
      hasAlpha: false
    };
  }
  return {
    format,
    width: result.width,
    height: result.height,
    hasAlpha: result.hasAlpha ?? false
  };
}
function detectImageFormat(input) {
  const data = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  return detectFormat(data);
}

// src/decoders/simple.ts
function isNode() {
  return typeof process !== "undefined" && process.versions != null && process.versions.node != null;
}
async function initCodecForNode(initFn, wasmPath) {
  const { readFile } = await import('fs/promises');
  const { createRequire } = await import('module');
  const require2 = createRequire(import.meta.url);
  const resolvedPath = require2.resolve(wasmPath);
  const wasmBuffer = await readFile(resolvedPath);
  const wasmModule2 = await WebAssembly.compile(wasmBuffer);
  await initFn(wasmModule2);
}
var SimpleDecoder = class {
  format;
  supportsScanline = false;
  supportsScaledDecode = false;
  data;
  width = 0;
  height = 0;
  hasAlpha = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decodeFn = null;
  constructor(format, data) {
    this.format = format;
    this.data = data;
  }
  async init(data) {
    this.data = data;
    switch (this.format) {
      case "avif": {
        const { default: decode, init } = await import('@jsquash/avif/decode.js');
        if (isNode()) {
          await initCodecForNode(init, "@jsquash/avif/codec/dec/avif_dec.wasm");
        }
        this.decodeFn = decode;
        this.hasAlpha = true;
        break;
      }
      case "webp": {
        const { default: decode, init } = await import('@jsquash/webp/decode.js');
        if (isNode()) {
          await initCodecForNode(init, "@jsquash/webp/codec/dec/webp_dec.wasm");
        }
        this.decodeFn = decode;
        this.hasAlpha = true;
        break;
      }
      case "jpeg":
      case "png":
        throw new Error(
          `${this.format.toUpperCase()} requires native WASM decoder. Build the WASM module with \`pnpm build:wasm\` in the @standardagents/sip repo root.`
        );
      default:
        throw new Error(`Unsupported format for SimpleDecoder: ${this.format}`);
    }
    const imageData = await this.decodeFn(this.data);
    if (!imageData) {
      throw new Error(`Failed to decode ${this.format} image`);
    }
    this.width = imageData.width;
    this.height = imageData.height;
    return {
      width: this.width,
      height: this.height,
      hasAlpha: this.hasAlpha
    };
  }
  async decode(_scaleFactor) {
    if (!this.decodeFn) {
      throw new Error("Decoder not initialized. Call init() first.");
    }
    const imageData = await this.decodeFn(this.data);
    this.width = imageData.width;
    this.height = imageData.height;
    const rgba = new Uint8Array(imageData.data.buffer);
    const rgb = new Uint8Array(this.width * this.height * 3);
    let srcIdx = 0;
    let dstIdx = 0;
    const pixelCount = this.width * this.height;
    for (let i = 0; i < pixelCount; i++) {
      rgb[dstIdx++] = rgba[srcIdx++];
      rgb[dstIdx++] = rgba[srcIdx++];
      rgb[dstIdx++] = rgba[srcIdx++];
      srcIdx++;
    }
    return {
      pixels: rgb,
      width: this.width,
      height: this.height
    };
  }
  dispose() {
    this.decodeFn = null;
  }
};
async function createDecoder(format, data) {
  const decoder = new SimpleDecoder(format, data);
  await decoder.init(data);
  return decoder;
}

// src/wasm/loader.ts
var wasmModule = null;
var wasmPromise = null;
var precompiledWasmModule = null;
function isWasmAvailable() {
  return wasmModule !== null;
}
async function initWithWasmModule(compiledModule) {
  if (wasmModule) {
    return;
  }
  if (compiledModule) {
    precompiledWasmModule = compiledModule;
  }
  await loadWasm();
}
function getWasmModule() {
  if (!wasmModule) {
    throw new Error("WASM module not loaded. Call loadWasm() first.");
  }
  return wasmModule;
}
async function loadWasm() {
  if (wasmModule) {
    return wasmModule;
  }
  if (wasmPromise) {
    return wasmPromise;
  }
  wasmPromise = doLoadWasm();
  try {
    wasmModule = await wasmPromise;
    return wasmModule;
  } catch (err) {
    wasmPromise = null;
    throw err;
  }
}
async function doLoadWasm() {
  if (typeof globalThis !== "undefined" && globalThis.__SIP_WASM_LOADER__) {
    const loader = globalThis.__SIP_WASM_LOADER__;
    return await loader();
  }
  try {
    const createSipModule = (await import('./sip.js')).default;
    if (precompiledWasmModule) {
      const module2 = await new Promise((resolve, reject) => {
        let resolvedModule = null;
        createSipModule({
          instantiateWasm: (imports, receiveInstance) => {
            WebAssembly.instantiate(precompiledWasmModule, imports).then((instance) => {
              receiveInstance(instance);
            }).catch((err) => {
              reject(err);
            });
            return {};
          },
          onRuntimeInitialized: () => {
            if (resolvedModule && resolvedModule.HEAPU8) {
              resolve(resolvedModule);
            }
          }
        }).then((mod) => {
          resolvedModule = mod;
          if (mod.HEAPU8) {
            resolve(mod);
          }
        }).catch(reject);
      });
      return module2;
    }
    const module = await createSipModule();
    return module;
  } catch (err) {
    throw new Error(
      "SIP WASM module not available. To use streaming processing, build the WASM module with `pnpm build:wasm` in the @standardagents/sip repo root. Error: " + (err instanceof Error ? err.message : String(err))
    );
  }
}
function copyToWasm(module, data) {
  const ptr = module._malloc(data.length);
  if (!ptr) {
    throw new Error("Failed to allocate WASM memory");
  }
  module.HEAPU8.set(data, ptr);
  return ptr;
}
function copyFromWasm(module, ptr, size) {
  return new Uint8Array(module.HEAPU8.buffer, ptr, size).slice();
}

// src/wasm/decoder.ts
var WasmJpegDecoder = class {
  module;
  decoder = 0;
  dataPtr = 0;
  width = 0;
  height = 0;
  outputWidth = 0;
  outputHeight = 0;
  scaleDenom = 1;
  rowBufferPtr = 0;
  started = false;
  finished = false;
  constructor() {
    this.module = getWasmModule();
  }
  /**
   * Initialize decoder with JPEG data
   */
  init(data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.decoder = this.module._sip_decoder_create();
    if (!this.decoder) {
      throw new Error("Failed to create JPEG decoder");
    }
    this.dataPtr = copyToWasm(this.module, bytes);
    if (this.module._sip_decoder_set_source(this.decoder, this.dataPtr, bytes.length) !== 0) {
      this.dispose();
      throw new Error("Failed to set decoder source");
    }
    if (this.module._sip_decoder_read_header(this.decoder) !== 0) {
      this.dispose();
      throw new Error("Failed to read JPEG header");
    }
    this.width = this.module._sip_decoder_get_width(this.decoder);
    this.height = this.module._sip_decoder_get_height(this.decoder);
    this.outputWidth = this.width;
    this.outputHeight = this.height;
    return { width: this.width, height: this.height };
  }
  /**
   * Get original image dimensions
   */
  getDimensions() {
    return { width: this.width, height: this.height };
  }
  /**
   * Set DCT scale factor for decoding
   *
   * Must be called after init() and before start()
   *
   * @param scaleDenom - Scale denominator: 1, 2, 4, or 8
   *   1 = full size (default)
   *   2 = 1/2 size
   *   4 = 1/4 size
   *   8 = 1/8 size
   */
  setScale(scaleDenom) {
    if (!this.decoder) {
      throw new Error("Decoder not initialized");
    }
    if (this.started) {
      throw new Error("Cannot change scale after decoding started");
    }
    if (this.module._sip_decoder_set_scale(this.decoder, scaleDenom) !== 0) {
      throw new Error(`Invalid scale denominator: ${scaleDenom}`);
    }
    this.scaleDenom = scaleDenom;
    this.outputWidth = this.module._sip_decoder_get_output_width(this.decoder);
    this.outputHeight = this.module._sip_decoder_get_output_height(this.decoder);
    return { width: this.outputWidth, height: this.outputHeight };
  }
  /**
   * Get output dimensions (after any scaling)
   */
  getOutputDimensions() {
    return { width: this.outputWidth, height: this.outputHeight };
  }
  /**
   * Start decoding
   */
  start() {
    if (!this.decoder) {
      throw new Error("Decoder not initialized");
    }
    if (this.started) {
      throw new Error("Decoding already started");
    }
    if (this.module._sip_decoder_start(this.decoder) !== 0) {
      throw new Error("Failed to start decompression");
    }
    this.rowBufferPtr = this.module._sip_decoder_get_row_buffer(this.decoder);
    if (!this.rowBufferPtr) {
      throw new Error("Failed to get row buffer");
    }
    this.started = true;
  }
  /**
   * Read next scanline
   *
   * @returns Scanline object or null if no more scanlines
   */
  readScanline() {
    if (!this.started || this.finished) {
      return null;
    }
    const result = this.module._sip_decoder_read_scanline(this.decoder);
    if (result === 0) {
      this.finished = true;
      return null;
    }
    if (result < 0) {
      throw new Error("Failed to read scanline");
    }
    const y = this.module._sip_decoder_get_scanline(this.decoder) - 1;
    const rowSize = this.outputWidth * 3;
    const data = new Uint8Array(
      this.module.HEAPU8.buffer,
      this.rowBufferPtr,
      rowSize
    ).slice();
    return {
      data,
      width: this.outputWidth,
      y
    };
  }
  /**
   * Read all remaining scanlines
   *
   * @yields Scanline objects
   */
  *readAllScanlines() {
    let scanline;
    while ((scanline = this.readScanline()) !== null) {
      yield scanline;
    }
  }
  /**
   * Decode entire image to RGB buffer
   *
   * @returns Full RGB pixel buffer
   */
  decodeAll() {
    if (!this.started) {
      this.start();
    }
    const pixels = new Uint8Array(this.outputWidth * this.outputHeight * 3);
    const rowSize = this.outputWidth * 3;
    for (const scanline of this.readAllScanlines()) {
      pixels.set(scanline.data, scanline.y * rowSize);
    }
    return {
      pixels,
      width: this.outputWidth,
      height: this.outputHeight
    };
  }
  /**
   * Clean up resources
   */
  dispose() {
    if (this.decoder) {
      this.module._sip_decoder_destroy(this.decoder);
      this.decoder = 0;
    }
    if (this.dataPtr) {
      this.module._free(this.dataPtr);
      this.dataPtr = 0;
    }
    this.started = false;
    this.finished = false;
    this.rowBufferPtr = 0;
  }
};
function calculateOptimalScale(srcWidth, srcHeight, targetWidth, targetHeight) {
  const scales = [8, 4, 2, 1];
  for (const scale of scales) {
    const scaledWidth = Math.ceil(srcWidth / scale);
    const scaledHeight = Math.ceil(srcHeight / scale);
    if (scaledWidth >= targetWidth && scaledHeight >= targetHeight) {
      return scale;
    }
  }
  return 1;
}

// src/wasm/encoder.ts
var WasmJpegEncoder = class {
  module;
  encoder = 0;
  width = 0;
  height = 0;
  quality = 85;
  rowBufferPtr = 0;
  started = false;
  finished = false;
  currentLine = 0;
  constructor() {
    this.module = getWasmModule();
  }
  /**
   * Initialize encoder with output dimensions and quality
   *
   * @param width - Output image width
   * @param height - Output image height
   * @param quality - JPEG quality (1-100, default 85)
   */
  init(width, height, quality = 85) {
    this.width = width;
    this.height = height;
    this.quality = Math.max(1, Math.min(100, quality));
    this.encoder = this.module._sip_encoder_create();
    if (!this.encoder) {
      throw new Error("Failed to create JPEG encoder");
    }
    if (this.module._sip_encoder_init(this.encoder, width, height, this.quality) !== 0) {
      this.dispose();
      throw new Error("Failed to initialize encoder");
    }
  }
  /**
   * Start encoding
   */
  start() {
    if (!this.encoder) {
      throw new Error("Encoder not initialized");
    }
    if (this.started) {
      throw new Error("Encoding already started");
    }
    if (this.module._sip_encoder_start(this.encoder) !== 0) {
      throw new Error("Failed to start compression");
    }
    this.rowBufferPtr = this.module._sip_encoder_get_row_buffer(this.encoder);
    if (!this.rowBufferPtr) {
      throw new Error("Failed to get row buffer");
    }
    this.started = true;
    this.currentLine = 0;
  }
  /**
   * Write a scanline to the encoder
   *
   * @param scanline - Scanline with RGB data
   */
  writeScanline(scanline) {
    this.writeScanlineData(scanline.data);
  }
  /**
   * Write raw RGB data as a scanline
   *
   * @param data - RGB data (width * 3 bytes)
   */
  writeScanlineData(data) {
    if (!this.started || this.finished) {
      throw new Error("Encoder not ready for writing");
    }
    if (this.currentLine >= this.height) {
      throw new Error("All scanlines already written");
    }
    const expectedSize = this.width * 3;
    if (data.length !== expectedSize) {
      throw new Error(`Invalid scanline size: expected ${expectedSize}, got ${data.length}`);
    }
    this.module.HEAPU8.set(data, this.rowBufferPtr);
    if (this.module._sip_encoder_write_scanline(this.encoder) !== 1) {
      throw new Error("Failed to write scanline");
    }
    this.currentLine++;
  }
  /**
   * Get current scanline number
   */
  getCurrentLine() {
    return this.currentLine;
  }
  /**
   * Finish encoding and get output
   *
   * @returns JPEG data as ArrayBuffer
   */
  finish() {
    if (!this.started) {
      throw new Error("Encoding not started");
    }
    if (this.currentLine !== this.height) {
      throw new Error(`Incomplete image: wrote ${this.currentLine}/${this.height} scanlines`);
    }
    if (this.module._sip_encoder_finish(this.encoder) !== 0) {
      throw new Error("Failed to finish encoding");
    }
    this.finished = true;
    const outputPtr = this.module._sip_encoder_get_output(this.encoder);
    const outputSize = this.module._sip_encoder_get_output_size(this.encoder);
    if (!outputPtr || !outputSize) {
      throw new Error("No output data");
    }
    const output = copyFromWasm(this.module, outputPtr, outputSize);
    return output.buffer;
  }
  /**
   * Encode a full RGB buffer to JPEG
   *
   * @param pixels - RGB pixel data (width * height * 3 bytes)
   * @returns JPEG data as ArrayBuffer
   */
  encodeAll(pixels) {
    if (pixels.length !== this.width * this.height * 3) {
      throw new Error(`Invalid pixel data size: expected ${this.width * this.height * 3}, got ${pixels.length}`);
    }
    this.start();
    const rowSize = this.width * 3;
    for (let y = 0; y < this.height; y++) {
      const rowData = pixels.subarray(y * rowSize, (y + 1) * rowSize);
      this.writeScanlineData(rowData);
    }
    return this.finish();
  }
  /**
   * Clean up resources
   */
  dispose() {
    if (this.encoder) {
      this.module._sip_encoder_destroy(this.encoder);
      this.encoder = 0;
    }
    this.started = false;
    this.finished = false;
    this.rowBufferPtr = 0;
    this.currentLine = 0;
  }
};

// src/wasm/png-decoder.ts
var WasmPngDecoder = class {
  module;
  decoder = 0;
  dataPtr = 0;
  width = 0;
  height = 0;
  hasAlpha = false;
  rowBufferPtr = 0;
  started = false;
  finished = false;
  currentRow = 0;
  constructor() {
    this.module = getWasmModule();
  }
  /**
   * Initialize decoder with PNG data
   */
  init(data) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.decoder = this.module._sip_png_decoder_create();
    if (!this.decoder) {
      throw new Error("Failed to create PNG decoder");
    }
    this.dataPtr = copyToWasm(this.module, bytes);
    if (this.module._sip_png_decoder_set_source(this.decoder, this.dataPtr, bytes.length) !== 0) {
      this.dispose();
      throw new Error("Failed to set PNG decoder source");
    }
    if (this.module._sip_png_decoder_read_header(this.decoder) !== 0) {
      this.dispose();
      throw new Error("Failed to read PNG header");
    }
    this.width = this.module._sip_png_decoder_get_width(this.decoder);
    this.height = this.module._sip_png_decoder_get_height(this.decoder);
    this.hasAlpha = this.module._sip_png_decoder_has_alpha(this.decoder) !== 0;
    return { width: this.width, height: this.height, hasAlpha: this.hasAlpha };
  }
  /**
   * Get image dimensions
   */
  getDimensions() {
    return { width: this.width, height: this.height };
  }
  /**
   * Check if image has alpha channel
   */
  getHasAlpha() {
    return this.hasAlpha;
  }
  /**
   * Start decoding
   */
  start() {
    if (!this.decoder) {
      throw new Error("Decoder not initialized");
    }
    if (this.started) {
      throw new Error("Decoding already started");
    }
    if (this.module._sip_png_decoder_start(this.decoder) !== 0) {
      throw new Error("Failed to start PNG decompression");
    }
    this.rowBufferPtr = this.module._sip_png_decoder_get_row_buffer(this.decoder);
    if (!this.rowBufferPtr) {
      throw new Error("Failed to get row buffer");
    }
    this.started = true;
    this.currentRow = 0;
  }
  /**
   * Read next scanline
   *
   * @returns Scanline object or null if no more scanlines
   */
  readScanline() {
    if (!this.started || this.finished) {
      return null;
    }
    if (this.currentRow >= this.height) {
      this.finished = true;
      return null;
    }
    const result = this.module._sip_png_decoder_read_row(this.decoder);
    if (result < 0) {
      throw new Error("Failed to read PNG row");
    }
    const rowSize = this.width * 3;
    const data = new Uint8Array(
      this.module.HEAPU8.buffer,
      this.rowBufferPtr,
      rowSize
    ).slice();
    const y = this.currentRow;
    this.currentRow++;
    if (result === 0 || this.currentRow >= this.height) {
      this.finished = true;
    }
    return {
      data,
      width: this.width,
      y
    };
  }
  /**
   * Read all remaining scanlines
   *
   * @yields Scanline objects
   */
  *readAllScanlines() {
    let scanline;
    while ((scanline = this.readScanline()) !== null) {
      yield scanline;
    }
  }
  /**
   * Decode entire image to RGB buffer
   *
   * @returns Full RGB pixel buffer
   */
  decodeAll() {
    if (!this.started) {
      this.start();
    }
    const pixels = new Uint8Array(this.width * this.height * 3);
    const rowSize = this.width * 3;
    for (const scanline of this.readAllScanlines()) {
      pixels.set(scanline.data, scanline.y * rowSize);
    }
    return {
      pixels,
      width: this.width,
      height: this.height
    };
  }
  /**
   * Clean up resources
   */
  dispose() {
    if (this.decoder) {
      this.module._sip_png_decoder_destroy(this.decoder);
      this.decoder = 0;
    }
    if (this.dataPtr) {
      this.module._free(this.dataPtr);
      this.dataPtr = 0;
    }
    this.started = false;
    this.finished = false;
    this.rowBufferPtr = 0;
    this.currentRow = 0;
  }
};

// src/encoder.ts
var NativeEncoder = class {
  supportsScanline = true;
  width = 0;
  height = 0;
  quality = 85;
  wasmEncoder = null;
  async init(width, height, quality) {
    this.width = width;
    this.height = height;
    this.quality = quality;
    await loadWasm();
    this.wasmEncoder = new WasmJpegEncoder();
    this.wasmEncoder.init(width, height, quality);
  }
  async encode(pixels) {
    if (!this.wasmEncoder) {
      throw new Error("Encoder not initialized. Call init() first.");
    }
    return this.wasmEncoder.encodeAll(pixels);
  }
  dispose() {
    if (this.wasmEncoder) {
      this.wasmEncoder.dispose();
      this.wasmEncoder = null;
    }
  }
};
async function createEncoder(width, height, quality) {
  const encoder = new NativeEncoder();
  await encoder.init(width, height, quality);
  return encoder;
}

// src/resize.ts
function createResizeState(srcWidth, srcHeight, dstWidth, dstHeight) {
  return {
    srcWidth,
    srcHeight,
    dstWidth,
    dstHeight,
    bufferA: null,
    bufferB: null,
    bufferAY: -1,
    bufferBY: -1,
    currentOutputY: 0
  };
}
function resizeRowHorizontal(src, srcWidth, dstWidth) {
  const dst = new Uint8Array(dstWidth * 3);
  const xScale = srcWidth / dstWidth;
  for (let dstX = 0; dstX < dstWidth; dstX++) {
    const srcXFloat = dstX * xScale;
    const srcX0 = Math.floor(srcXFloat);
    const srcX1 = Math.min(srcX0 + 1, srcWidth - 1);
    const t = srcXFloat - srcX0;
    const invT = 1 - t;
    const src0 = srcX0 * 3;
    const src1 = srcX1 * 3;
    const dstOffset = dstX * 3;
    dst[dstOffset] = Math.round(src[src0] * invT + src[src1] * t);
    dst[dstOffset + 1] = Math.round(src[src0 + 1] * invT + src[src1 + 1] * t);
    dst[dstOffset + 2] = Math.round(src[src0 + 2] * invT + src[src1 + 2] * t);
  }
  return dst;
}
function blendRows(rowA, rowB, t, width) {
  const result = new Uint8Array(width * 3);
  const invT = 1 - t;
  for (let i = 0; i < width * 3; i++) {
    result[i] = Math.round(rowA[i] * invT + rowB[i] * t);
  }
  return result;
}
function processScanline(state, srcScanline, srcY) {
  const { srcWidth, srcHeight, dstWidth, dstHeight } = state;
  const yScale = srcHeight / dstHeight;
  const output = [];
  const resizedRow = resizeRowHorizontal(srcScanline, srcWidth, dstWidth);
  state.bufferA = state.bufferB;
  state.bufferAY = state.bufferBY;
  state.bufferB = resizedRow;
  state.bufferBY = srcY;
  while (state.currentOutputY < dstHeight) {
    const srcYFloat = state.currentOutputY * yScale;
    const srcYFloor = Math.floor(srcYFloat);
    const srcYCeil = Math.min(srcYFloor + 1, srcHeight - 1);
    if (srcYCeil > srcY) {
      break;
    }
    if (state.bufferA === null) {
      output.push({
        data: state.bufferB,
        width: dstWidth,
        y: state.currentOutputY
      });
      state.currentOutputY++;
      continue;
    }
    const t = srcYFloat - srcYFloor;
    let rowA = state.bufferA;
    let rowB = state.bufferB;
    if (srcYFloor === state.bufferBY) {
      rowA = state.bufferB;
      rowB = state.bufferB;
    } else if (srcYCeil === state.bufferAY) {
      rowA = state.bufferA;
      rowB = state.bufferA;
    }
    const blended = blendRows(rowA, rowB, t, dstWidth);
    output.push({
      data: blended,
      width: dstWidth,
      y: state.currentOutputY
    });
    state.currentOutputY++;
  }
  return output;
}
function flushResize(state) {
  const output = [];
  while (state.currentOutputY < state.dstHeight) {
    if (state.bufferB === null) break;
    output.push({
      data: state.bufferB,
      width: state.dstWidth,
      y: state.currentOutputY
    });
    state.currentOutputY++;
  }
  return output;
}
function calculateTargetDimensions(srcWidth, srcHeight, maxWidth, maxHeight) {
  const scaleX = maxWidth / srcWidth;
  const scaleY = maxHeight / srcHeight;
  const scale = Math.min(scaleX, scaleY, 1);
  return {
    width: Math.round(srcWidth * scale),
    height: Math.round(srcHeight * scale),
    scale
  };
}
function calculateDctScaleFactor(srcWidth, srcHeight, targetWidth, targetHeight) {
  const scales = [8, 4, 2, 1];
  for (const scale of scales) {
    const scaledWidth = Math.ceil(srcWidth / scale);
    const scaledHeight = Math.ceil(srcHeight / scale);
    if (scaledWidth >= targetWidth && scaledHeight >= targetHeight) {
      return scale;
    }
  }
  return 1;
}

// src/streaming.ts
var DEFAULT_OPTIONS = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxBytes: 1.5 * 1024 * 1024,
  quality: 85
};
async function processJpegStreaming(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  await loadWasm();
  const decoder = new WasmJpegDecoder();
  try {
    const { width: srcWidth, height: srcHeight } = decoder.init(input);
    const target = calculateTargetDimensions(
      srcWidth,
      srcHeight,
      opts.maxWidth,
      opts.maxHeight
    );
    const dctScale = calculateOptimalScale(
      srcWidth,
      srcHeight,
      target.width,
      target.height
    );
    const { width: decodeWidth, height: decodeHeight } = decoder.setScale(dctScale);
    const resizeState = createResizeState(
      decodeWidth,
      decodeHeight,
      target.width,
      target.height
    );
    const encoder = new WasmJpegEncoder();
    encoder.init(target.width, target.height, opts.quality);
    encoder.start();
    decoder.start();
    let decodedLine = 0;
    for (const scanline of decoder.readAllScanlines()) {
      const outputScanlines = processScanline(resizeState, scanline.data, decodedLine);
      decodedLine++;
      for (const outScanline of outputScanlines) {
        encoder.writeScanline(outScanline);
      }
    }
    const remaining = flushResize(resizeState);
    for (const outScanline of remaining) {
      encoder.writeScanline(outScanline);
    }
    const jpegData = encoder.finish();
    if (jpegData.byteLength > opts.maxBytes && opts.quality > 45) {
      encoder.dispose();
      decoder.dispose();
      return processJpegStreaming(input, {
        ...opts,
        quality: opts.quality - 10
      });
    }
    encoder.dispose();
    return {
      data: jpegData,
      width: target.width,
      height: target.height,
      mimeType: "image/jpeg",
      originalFormat: "jpeg"
    };
  } finally {
    decoder.dispose();
  }
}
async function processPngStreaming(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  await loadWasm();
  const decoder = new WasmPngDecoder();
  try {
    const { width: srcWidth, height: srcHeight } = decoder.init(input);
    const target = calculateTargetDimensions(
      srcWidth,
      srcHeight,
      opts.maxWidth,
      opts.maxHeight
    );
    const resizeState = createResizeState(
      srcWidth,
      srcHeight,
      target.width,
      target.height
    );
    const encoder = new WasmJpegEncoder();
    encoder.init(target.width, target.height, opts.quality);
    encoder.start();
    decoder.start();
    let decodedLine = 0;
    for (const scanline of decoder.readAllScanlines()) {
      const outputScanlines = processScanline(resizeState, scanline.data, decodedLine);
      decodedLine++;
      for (const outScanline of outputScanlines) {
        encoder.writeScanline(outScanline);
      }
    }
    const remaining = flushResize(resizeState);
    for (const outScanline of remaining) {
      encoder.writeScanline(outScanline);
    }
    const jpegData = encoder.finish();
    if (jpegData.byteLength > opts.maxBytes && opts.quality > 45) {
      encoder.dispose();
      decoder.dispose();
      return processPngStreaming(input, {
        ...opts,
        quality: opts.quality - 10
      });
    }
    encoder.dispose();
    return {
      data: jpegData,
      width: target.width,
      height: target.height,
      mimeType: "image/jpeg",
      originalFormat: "png"
    };
  } finally {
    decoder.dispose();
  }
}
function isStreamingAvailable() {
  return isWasmAvailable();
}
async function initStreaming() {
  try {
    await loadWasm();
    return true;
  } catch {
    return false;
  }
}

// src/pipeline.ts
var DEFAULT_OPTIONS2 = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxBytes: 1.5 * 1024 * 1024,
  // 1.5MB
  quality: 85
};
async function process2(input, options = {}) {
  const opts = { ...DEFAULT_OPTIONS2, ...options };
  const probeResult = probe(input);
  if (probeResult.format === "unknown") {
    throw new Error("Unknown image format");
  }
  const { format, width: srcWidth, height: srcHeight } = probeResult;
  if (format === "jpeg") {
    return await processJpegStreaming(input, opts);
  }
  if (format === "png") {
    return await processPngStreaming(input, opts);
  }
  await loadWasm();
  const target = calculateTargetDimensions(
    srcWidth,
    srcHeight,
    opts.maxWidth,
    opts.maxHeight
  );
  const decoder = await createDecoder(format, input);
  const { pixels: srcPixels, width: decodedWidth, height: decodedHeight } = await decoder.decode();
  decoder.dispose();
  const resizedPixels = resizePixelBuffer(
    srcPixels,
    decodedWidth,
    decodedHeight,
    target.width,
    target.height
  );
  let quality = opts.quality;
  let jpegData = await encodeToJpeg(resizedPixels, target.width, target.height, quality);
  while (jpegData.byteLength > opts.maxBytes && quality > 45) {
    quality -= 10;
    jpegData = await encodeToJpeg(resizedPixels, target.width, target.height, quality);
  }
  if (jpegData.byteLength > opts.maxBytes) {
    const scaleFactor = Math.sqrt(opts.maxBytes / jpegData.byteLength) * 0.9;
    const newWidth = Math.round(target.width * scaleFactor);
    const newHeight = Math.round(target.height * scaleFactor);
    const smallerPixels = resizePixelBuffer(
      resizedPixels,
      target.width,
      target.height,
      newWidth,
      newHeight
    );
    jpegData = await encodeToJpeg(smallerPixels, newWidth, newHeight, quality);
    return {
      data: jpegData,
      width: newWidth,
      height: newHeight,
      mimeType: "image/jpeg",
      originalFormat: format
    };
  }
  return {
    data: jpegData,
    width: target.width,
    height: target.height,
    mimeType: "image/jpeg",
    originalFormat: format
  };
}
function resizePixelBuffer(srcPixels, srcWidth, srcHeight, dstWidth, dstHeight) {
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return srcPixels;
  }
  const state = createResizeState(srcWidth, srcHeight, dstWidth, dstHeight);
  const outputRows = new Array(dstHeight);
  const srcRowSize = srcWidth * 3;
  for (let y = 0; y < srcHeight; y++) {
    const srcRow = srcPixels.subarray(y * srcRowSize, (y + 1) * srcRowSize);
    const outputScanlines = processScanline(state, srcRow, y);
    for (const scanline of outputScanlines) {
      outputRows[scanline.y] = scanline.data;
    }
  }
  const remaining = flushResize(state);
  for (const scanline of remaining) {
    outputRows[scanline.y] = scanline.data;
  }
  const dstRowSize = dstWidth * 3;
  const result = new Uint8Array(dstWidth * dstHeight * 3);
  for (let y = 0; y < dstHeight; y++) {
    if (outputRows[y]) {
      result.set(outputRows[y], y * dstRowSize);
    }
  }
  return result;
}
async function encodeToJpeg(pixels, width, height, quality) {
  const encoder = await createEncoder(width, height, quality);
  const result = await encoder.encode(pixels);
  encoder.dispose();
  return result;
}

// src/index.ts
var sip = {
  process: process2,
  probe,
  detectImageFormat,
  initStreaming,
  isStreamingAvailable
};

export { WasmJpegDecoder, WasmJpegEncoder, WasmPngDecoder, calculateDctScaleFactor, calculateOptimalScale, calculateTargetDimensions, createResizeState, detectImageFormat, flushResize, getWasmModule, initStreaming, initWithWasmModule, isStreamingAvailable, isWasmAvailable, loadWasm, probe, process2 as process, processJpegStreaming, processScanline, sip };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map