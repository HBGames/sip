/**
 * Supported input image formats
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'unknown';

/**
 * Image metadata discovered during inspection
 */
export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
}

/**
 * Backward-compatible alias for callers that still import ProbeResult internally.
 */
export type ProbeResult = ImageInfo;

/**
 * Byte-oriented inputs accepted by the new API.
 */
export type ByteInput =
  | ArrayBuffer
  | Uint8Array
  | Blob
  | Request
  | Response
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface TransformOptions {
  width?: number;
  height?: number;
  quality?: number;
}

/**
 * Internal/publicly returned reusable source after inspect().
 * `open()` may only be called once for streamed inputs.
 */
export interface InputSource {
  readonly kind: 'bytes' | 'stream';
  readonly replayable: boolean;
  readonly formatHint?: ImageFormat;
  readonly byteLength?: number;
  readonly headerBytes: Uint8Array<ArrayBufferLike>;
  open(): AsyncIterable<Uint8Array>;
}

export interface TransformStats {
  peakPipelineBytes: number;
  peakCodecBytes: number;
  peakBufferedInputBytes: number;
  peakBufferedOutputBytes: number;
  bytesIn: number;
  bytesOut: number;
  notes: string[];
}

export interface EncodedImageInfo {
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  originalFormat: Exclude<ImageFormat, 'unknown'>;
}

export interface EncodedImage extends AsyncIterable<Uint8Array> {
  readonly info: Promise<EncodedImageInfo>;
  readonly stats: Promise<TransformStats>;
}

export interface InspectResult {
  info: ImageInfo;
  source: InputSource;
}

/**
 * Internal: A single scanline of RGB pixel data
 */
export interface Scanline {
  /** RGB pixel data (width * 3 bytes) */
  data: Uint8Array;
  /** Width in pixels */
  width: number;
  /** Y position in the image (0-indexed) */
  y: number;
}

export interface PixelStream extends AsyncIterable<Scanline> {
  readonly info: Promise<{
    width: number;
    height: number;
    originalFormat: Exclude<ImageFormat, 'unknown'>;
  }>;
  readonly stats?: Promise<TransformStats>;
}

/**
 * Legacy process options retained for a small amount of internal compatibility while
 * the old files remain in the tree.
 */
export interface ProcessOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  quality?: number;
}

/**
 * Legacy process result retained for internal compatibility.
 */
export interface ProcessResult {
  data: ArrayBuffer;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  originalFormat: ImageFormat;
}

/**
 * Internal: Decoder state for streaming decode
 */
export interface DecoderState {
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
export interface EncoderState {
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
export interface ResizeState {
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
