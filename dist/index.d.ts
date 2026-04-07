/**
 * Supported input image formats
 */
type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'unknown';
/**
 * Image metadata discovered during inspection
 */
interface ImageInfo {
    format: ImageFormat;
    width: number;
    height: number;
    hasAlpha: boolean;
}
/**
 * Backward-compatible alias for callers that still import ProbeResult internally.
 */
type ProbeResult = ImageInfo;
/**
 * Byte-oriented inputs accepted by the new API.
 */
type ByteInput = ArrayBuffer | Uint8Array | Blob | Request | Response | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
interface TransformOptions {
    width?: number;
    height?: number;
    quality?: number;
}
/**
 * Internal/publicly returned reusable source after inspect().
 * `open()` may only be called once for streamed inputs.
 */
interface InputSource {
    readonly kind: 'bytes' | 'stream';
    readonly replayable: boolean;
    readonly formatHint?: ImageFormat;
    readonly byteLength?: number;
    readonly headerBytes: Uint8Array<ArrayBufferLike>;
    open(): AsyncIterable<Uint8Array>;
}
interface TransformStats {
    peakPipelineBytes: number;
    peakCodecBytes: number;
    peakBufferedInputBytes: number;
    peakBufferedOutputBytes: number;
    bytesIn: number;
    bytesOut: number;
    notes: string[];
}
interface EncodedImageInfo {
    width: number;
    height: number;
    mimeType: 'image/jpeg';
    originalFormat: Exclude<ImageFormat, 'unknown'>;
}
interface EncodedImage extends AsyncIterable<Uint8Array> {
    readonly info: Promise<EncodedImageInfo>;
    readonly stats: Promise<TransformStats>;
}
interface InspectResult {
    info: ImageInfo;
    source: InputSource;
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
interface PixelStream extends AsyncIterable<Scanline> {
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
interface ProcessOptions {
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    quality?: number;
}
/**
 * Legacy process result retained for internal compatibility.
 */
interface ProcessResult {
    data: ArrayBuffer;
    width: number;
    height: number;
    mimeType: 'image/jpeg';
    originalFormat: ImageFormat;
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

declare function inspect(input: ByteInput): Promise<InspectResult>;

declare function decode(input: ByteInput | InputSource): PixelStream;
declare function resize(stream: PixelStream, options: TransformOptions): PixelStream;
declare function encodeJpeg(stream: PixelStream, options?: TransformOptions): EncodedImage;
declare function transform(input: ByteInput | InputSource, options?: TransformOptions): EncodedImage;
declare function ready(options?: {
    wasm?: WebAssembly.Module | ArrayBuffer;
}): Promise<void>;
declare function collect(image: EncodedImage): Promise<{
    data: ArrayBuffer;
    info: EncodedImageInfo;
    stats: TransformStats;
}>;
declare function toReadableStream(image: EncodedImage): ReadableStream<Uint8Array>;
declare function toResponse(image: EncodedImage, init?: ResponseInit): Response;

export { type ByteInput, type DecoderState, type EncodedImage, type EncodedImageInfo, type EncoderState, type ImageFormat, type ImageInfo, type InputSource, type InspectResult, type PixelStream, type ProbeResult, type ProcessOptions, type ProcessResult, type ResizeState, type Scanline, type TransformOptions, type TransformStats, collect, decode, encodeJpeg, inspect, ready, resize, toReadableStream, toResponse, transform };
