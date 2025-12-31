/**
 * Supported input image formats
 */
type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'unknown';
/**
 * Result from probing an image's format and dimensions
 */
interface ProbeResult {
    /** Detected format */
    format: ImageFormat;
    /** Image width in pixels */
    width: number;
    /** Image height in pixels */
    height: number;
    /** Whether the image has an alpha channel */
    hasAlpha: boolean;
}
/**
 * Options for image processing
 */
interface ProcessOptions {
    /** Maximum output width */
    maxWidth?: number;
    /** Maximum output height */
    maxHeight?: number;
    /** Target output size in bytes (quality will be reduced to achieve this) */
    maxBytes?: number;
    /** JPEG quality (1-100, default: 85) */
    quality?: number;
}
/**
 * Result from processing an image
 */
interface ProcessResult {
    /** Processed image data */
    data: ArrayBuffer;
    /** Output width */
    width: number;
    /** Output height */
    height: number;
    /** Output MIME type (always image/jpeg) */
    mimeType: 'image/jpeg';
    /** Original format that was converted */
    originalFormat: ImageFormat;
}
/**
 * Internal: A single scanline of RGB pixel data
 */
interface Scanline {
    /** RGB pixel data (width * 3 bytes) */
    data: Uint8Array;
    /** Width in pixels */
    width: number;
    /** Y position in the image (0-indexed) */
    y: number;
}
/**
 * Internal: Decoder state for streaming decode
 */
interface DecoderState {
    /** Original image width */
    width: number;
    /** Original image height */
    height: number;
    /** Current scanline index */
    currentLine: number;
    /** Scale factor (1, 2, 4, or 8 for JPEG DCT scaling) */
    scaleFactor: number;
    /** Scaled width after DCT scaling */
    scaledWidth: number;
    /** Scaled height after DCT scaling */
    scaledHeight: number;
}
/**
 * Internal: Encoder state for streaming encode
 */
interface EncoderState {
    /** Output width */
    width: number;
    /** Output height */
    height: number;
    /** JPEG quality (1-100) */
    quality: number;
    /** Current scanline being encoded */
    currentLine: number;
    /** Accumulated output chunks */
    chunks: Uint8Array[];
}
/**
 * Internal: Resize state for scanline-based bilinear interpolation
 */
interface ResizeState {
    /** Source width */
    srcWidth: number;
    /** Source height */
    srcHeight: number;
    /** Target width */
    dstWidth: number;
    /** Target height */
    dstHeight: number;
    /** Buffer A (previous source row, already scaled horizontally) */
    bufferA: Uint8Array | null;
    /** Buffer B (current source row, already scaled horizontally) */
    bufferB: Uint8Array | null;
    /** Source Y index for buffer A */
    bufferAY: number;
    /** Source Y index for buffer B */
    bufferBY: number;
    /** Current output Y position */
    currentOutputY: number;
}

/**
 * Probe an image to get format and dimensions
 * Only reads the header bytes - very memory efficient
 *
 * @param input - Image data as ArrayBuffer or Uint8Array
 * @returns ProbeResult with format, dimensions, and alpha info
 */
declare function probe(input: ArrayBuffer | Uint8Array): ProbeResult;
/**
 * Detect just the format (faster if you don't need dimensions)
 */
declare function detectImageFormat(input: ArrayBuffer | Uint8Array): ImageFormat;

/**
 * Process an image: decode, resize, and encode to JPEG
 *
 * For JPEG images, uses ultra-memory-efficient streaming pipeline when WASM
 * is available (DCT scaling + scanline processing). Falls back to full-memory
 * decode for other formats or when WASM is not built.
 *
 * @param input - Image data as ArrayBuffer
 * @param options - Processing options
 * @returns Processed image result
 */
declare function process(input: ArrayBuffer, options?: ProcessOptions): Promise<ProcessResult>;

/**
 * Create a resize state for scanline-based bilinear interpolation
 *
 * This implements memory-efficient resizing that only needs 2 source rows
 * in memory at any time, regardless of image size.
 */
declare function createResizeState(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): ResizeState;
/**
 * Process a source scanline and potentially output resized scanlines
 *
 * This is the core of the streaming resize algorithm. Call this for each
 * source scanline in order (y = 0, 1, 2, ...). It will return output
 * scanlines as they become available.
 *
 * Memory usage: Only keeps 2 horizontally-resized rows in memory at a time
 *
 * @param state - Resize state (mutated)
 * @param srcScanline - Source scanline (RGB, 3 bytes per pixel)
 * @param srcY - Source Y position (must be called in order)
 * @returns Array of output scanlines (may be 0, 1, or more)
 */
declare function processScanline(state: ResizeState, srcScanline: Uint8Array, srcY: number): Scanline[];
/**
 * Flush any remaining output rows after all source rows have been processed
 *
 * @param state - Resize state
 * @returns Remaining output scanlines
 */
declare function flushResize(state: ResizeState): Scanline[];
/**
 * Calculate target dimensions while preserving aspect ratio
 *
 * @param srcWidth - Source width
 * @param srcHeight - Source height
 * @param maxWidth - Maximum target width
 * @param maxHeight - Maximum target height
 * @returns Target dimensions
 */
declare function calculateTargetDimensions(srcWidth: number, srcHeight: number, maxWidth: number, maxHeight: number): {
    width: number;
    height: number;
    scale: number;
};
/**
 * Calculate optimal JPEG DCT scale factor
 *
 * JPEG can decode at 1/1, 1/2, 1/4, or 1/8 scale using DCT scaling.
 * This dramatically reduces memory usage during decode.
 *
 * @param srcWidth - Source image width
 * @param srcHeight - Source image height
 * @param targetWidth - Desired output width
 * @param targetHeight - Desired output height
 * @returns Scale denominator (1, 2, 4, or 8)
 */
declare function calculateDctScaleFactor(srcWidth: number, srcHeight: number, targetWidth: number, targetHeight: number): 1 | 2 | 4 | 8;

/**
 * Streaming Image Processing Pipeline
 *
 * Ultra memory-efficient processing that:
 * 1. Decodes JPEG at reduced scale using DCT scaling
 * 2. Resizes using scanline-based bilinear interpolation (2 rows in memory)
 * 3. Encodes to JPEG scanline-by-scanline
 *
 * Peak memory usage is ~50KB regardless of input image size.
 */

/**
 * Process a JPEG image using streaming pipeline
 *
 * This is the ultra-memory-efficient path that:
 * - Uses DCT scaling to decode at reduced resolution
 * - Processes one scanline at a time
 * - Never holds the full image in memory
 *
 * @param input - JPEG image data
 * @param options - Processing options
 * @returns Processed JPEG result
 */
declare function processJpegStreaming(input: ArrayBuffer, options?: ProcessOptions): Promise<ProcessResult>;
/**
 * Check if streaming processing is available
 *
 * Returns false if WASM module is not built/loaded.
 */
declare function isStreamingAvailable(): boolean;
/**
 * Try to load WASM for streaming processing
 *
 * Call this early to warm up the WASM module.
 */
declare function initStreaming(): Promise<boolean>;

/**
 * TypeScript types for SIP WASM module
 */
/**
 * Emscripten module interface
 */
interface SipWasmModule {
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _sip_decoder_create(): number;
    _sip_decoder_set_source(dec: number, data: number, size: number): number;
    _sip_decoder_read_header(dec: number): number;
    _sip_decoder_get_width(dec: number): number;
    _sip_decoder_get_height(dec: number): number;
    _sip_decoder_set_scale(dec: number, scale_denom: number): number;
    _sip_decoder_get_output_width(dec: number): number;
    _sip_decoder_get_output_height(dec: number): number;
    _sip_decoder_start(dec: number): number;
    _sip_decoder_get_row_buffer(dec: number): number;
    _sip_decoder_read_scanline(dec: number): number;
    _sip_decoder_get_scanline(dec: number): number;
    _sip_decoder_finish(dec: number): number;
    _sip_decoder_destroy(dec: number): void;
    _sip_encoder_create(): number;
    _sip_encoder_init(enc: number, width: number, height: number, quality: number): number;
    _sip_encoder_start(enc: number): number;
    _sip_encoder_get_row_buffer(enc: number): number;
    _sip_encoder_write_scanline(enc: number): number;
    _sip_encoder_write_scanline_from(enc: number, data: number): number;
    _sip_encoder_get_scanline(enc: number): number;
    _sip_encoder_finish(enc: number): number;
    _sip_encoder_get_output(enc: number): number;
    _sip_encoder_get_output_size(enc: number): number;
    _sip_encoder_destroy(enc: number): void;
    _sip_png_decoder_create(): number;
    _sip_png_decoder_set_source(dec: number, data: number, size: number): number;
    _sip_png_decoder_read_header(dec: number): number;
    _sip_png_decoder_get_width(dec: number): number;
    _sip_png_decoder_get_height(dec: number): number;
    _sip_png_decoder_has_alpha(dec: number): number;
    _sip_png_decoder_start(dec: number): number;
    _sip_png_decoder_get_row_buffer(dec: number): number;
    _sip_png_decoder_read_row(dec: number): number;
    _sip_png_decoder_get_row(dec: number): number;
    _sip_png_decoder_finish(dec: number): number;
    _sip_png_decoder_destroy(dec: number): void;
    _sip_get_error(): number;
    _sip_malloc(size: number): number;
    _sip_free(ptr: number): void;
    UTF8ToString(ptr: number): string;
}
/**
 * Valid DCT scale denominators
 */
type DctScaleDenom = 1 | 2 | 4 | 8;

/**
 * WASM Module Loader
 *
 * Loads the SIP WASM module with proper initialization.
 * Works in both browser and Cloudflare Workers environments.
 *
 * For Cloudflare Workers, use initWithWasmModule() in the Durable Object
 * constructor, passing the statically imported WASM module.
 */

/**
 * Check if WASM module is available
 */
declare function isWasmAvailable(): boolean;
/**
 * Initialize with a pre-compiled WebAssembly.Module
 *
 * For Cloudflare Workers, import the WASM file statically and pass it here.
 * This allows workerd to pre-compile the WASM at bundle time.
 *
 * @example
 * ```typescript
 * import sipWasm from '@standardagents/sip/dist/sip.wasm';
 * import { initWithWasmModule } from '@standardagents/sip';
 *
 * // At module top level or in DO constructor
 * await initWithWasmModule(sipWasm);
 * ```
 */
declare function initWithWasmModule(compiledModule?: WebAssembly.Module): Promise<void>;
/**
 * Get the WASM module, throwing if not loaded
 */
declare function getWasmModule(): SipWasmModule;
/**
 * Load the WASM module
 *
 * This function is idempotent - calling it multiple times returns the same module.
 */
declare function loadWasm(): Promise<SipWasmModule>;

/**
 * WASM JPEG Decoder with Scaled DCT Support
 *
 * Memory-efficient JPEG decoding using libjpeg-turbo's scaled DCT feature.
 * Decodes at 1/2, 1/4, or 1/8 scale directly during decompression.
 */

/**
 * WASM-based JPEG decoder with scaled DCT support
 */
declare class WasmJpegDecoder {
    private module;
    private decoder;
    private dataPtr;
    private width;
    private height;
    private outputWidth;
    private outputHeight;
    private scaleDenom;
    private rowBufferPtr;
    private started;
    private finished;
    constructor();
    /**
     * Initialize decoder with JPEG data
     */
    init(data: ArrayBuffer | Uint8Array): {
        width: number;
        height: number;
    };
    /**
     * Get original image dimensions
     */
    getDimensions(): {
        width: number;
        height: number;
    };
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
    setScale(scaleDenom: DctScaleDenom): {
        width: number;
        height: number;
    };
    /**
     * Get output dimensions (after any scaling)
     */
    getOutputDimensions(): {
        width: number;
        height: number;
    };
    /**
     * Start decoding
     */
    start(): void;
    /**
     * Read next scanline
     *
     * @returns Scanline object or null if no more scanlines
     */
    readScanline(): Scanline | null;
    /**
     * Read all remaining scanlines
     *
     * @yields Scanline objects
     */
    readAllScanlines(): Generator<Scanline>;
    /**
     * Decode entire image to RGB buffer
     *
     * @returns Full RGB pixel buffer
     */
    decodeAll(): {
        pixels: Uint8Array;
        width: number;
        height: number;
    };
    /**
     * Clean up resources
     */
    dispose(): void;
}
/**
 * Calculate optimal DCT scale factor for a target size
 *
 * Returns the largest scale factor that keeps the output >= target size.
 *
 * @param srcWidth - Original image width
 * @param srcHeight - Original image height
 * @param targetWidth - Desired output width
 * @param targetHeight - Desired output height
 */
declare function calculateOptimalScale(srcWidth: number, srcHeight: number, targetWidth: number, targetHeight: number): DctScaleDenom;

/**
 * WASM JPEG Encoder with Scanline Streaming
 *
 * Memory-efficient JPEG encoding that processes one scanline at a time.
 */

/**
 * WASM-based JPEG encoder with scanline streaming
 */
declare class WasmJpegEncoder {
    private module;
    private encoder;
    private width;
    private height;
    private quality;
    private rowBufferPtr;
    private started;
    private finished;
    private currentLine;
    constructor();
    /**
     * Initialize encoder with output dimensions and quality
     *
     * @param width - Output image width
     * @param height - Output image height
     * @param quality - JPEG quality (1-100, default 85)
     */
    init(width: number, height: number, quality?: number): void;
    /**
     * Start encoding
     */
    start(): void;
    /**
     * Write a scanline to the encoder
     *
     * @param scanline - Scanline with RGB data
     */
    writeScanline(scanline: Scanline): void;
    /**
     * Write raw RGB data as a scanline
     *
     * @param data - RGB data (width * 3 bytes)
     */
    writeScanlineData(data: Uint8Array): void;
    /**
     * Get current scanline number
     */
    getCurrentLine(): number;
    /**
     * Finish encoding and get output
     *
     * @returns JPEG data as ArrayBuffer
     */
    finish(): ArrayBuffer;
    /**
     * Encode a full RGB buffer to JPEG
     *
     * @param pixels - RGB pixel data (width * height * 3 bytes)
     * @returns JPEG data as ArrayBuffer
     */
    encodeAll(pixels: Uint8Array): ArrayBuffer;
    /**
     * Clean up resources
     */
    dispose(): void;
}

/**
 * WASM PNG Decoder with Row-by-Row Processing
 *
 * Memory-efficient PNG decoding using libspng's progressive API.
 * Decodes one row at a time to minimize memory usage.
 */

/**
 * WASM-based PNG decoder with row-by-row decoding
 */
declare class WasmPngDecoder {
    private module;
    private decoder;
    private dataPtr;
    private width;
    private height;
    private hasAlpha;
    private rowBufferPtr;
    private started;
    private finished;
    private currentRow;
    constructor();
    /**
     * Initialize decoder with PNG data
     */
    init(data: ArrayBuffer | Uint8Array): {
        width: number;
        height: number;
        hasAlpha: boolean;
    };
    /**
     * Get image dimensions
     */
    getDimensions(): {
        width: number;
        height: number;
    };
    /**
     * Check if image has alpha channel
     */
    getHasAlpha(): boolean;
    /**
     * Start decoding
     */
    start(): void;
    /**
     * Read next scanline
     *
     * @returns Scanline object or null if no more scanlines
     */
    readScanline(): Scanline | null;
    /**
     * Read all remaining scanlines
     *
     * @yields Scanline objects
     */
    readAllScanlines(): Generator<Scanline>;
    /**
     * Decode entire image to RGB buffer
     *
     * @returns Full RGB pixel buffer
     */
    decodeAll(): {
        pixels: Uint8Array;
        width: number;
        height: number;
    };
    /**
     * Clean up resources
     */
    dispose(): void;
}

/**
 * @standardagents/sip - Small Image Processor
 *
 * Ultra memory-efficient image processing for Cloudflare Workers.
 *
 * Features:
 * - Format detection without full decode (probe)
 * - Scanline-based bilinear resize (constant memory)
 * - JPEG output with quality control
 * - Support for JPEG, PNG, WebP, AVIF input formats
 *
 * @example
 * ```typescript
 * import { sip } from '@standardagents/sip';
 *
 * // Process an image
 * const result = await sip.process(imageBuffer, {
 *   maxWidth: 2048,
 *   maxHeight: 2048,
 *   maxBytes: 1.5 * 1024 * 1024,
 *   quality: 85,
 * });
 *
 * // result.data: ArrayBuffer (JPEG)
 * // result.width, result.height: output dimensions
 * // result.mimeType: 'image/jpeg'
 *
 * // Just probe for info
 * const info = sip.probe(imageBuffer);
 * // info.format: 'jpeg' | 'png' | 'webp' | 'avif'
 * // info.width, info.height: original dimensions
 * ```
 */

declare const sip: {
    process: typeof process;
    probe: typeof probe;
    detectImageFormat: typeof detectImageFormat;
    initStreaming: typeof initStreaming;
    isStreamingAvailable: typeof isStreamingAvailable;
};

export { type DctScaleDenom, type DecoderState, type EncoderState, type ImageFormat, type ProbeResult, type ProcessOptions, type ProcessResult, type ResizeState, type Scanline, type SipWasmModule, WasmJpegDecoder, WasmJpegEncoder, WasmPngDecoder, calculateDctScaleFactor, calculateOptimalScale, calculateTargetDimensions, createResizeState, detectImageFormat, flushResize, getWasmModule, initStreaming, initWithWasmModule, isStreamingAvailable, isWasmAvailable, loadWasm, probe, process, processJpegStreaming, processScanline, sip };
