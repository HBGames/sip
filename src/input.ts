import { probe } from './probe';
import type { ByteInput, ImageInfo, ImageFormat, InputSource, InspectResult } from './types';

const INSPECT_TARGETS = [64, 512, 4_096, 16_384, 65_536, 262_144];

type PreparedInputSource = InputSource & {
  ensureHeaderBytes(target: number): Promise<Uint8Array>;
  readonly done: boolean;
};

function sliceArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function normalizeChunk(chunk: Uint8Array): Uint8Array {
  if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength) {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy;
  }

  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy;
}

async function* iterateReadableStream(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }

      if (value && value.byteLength > 0) {
        yield normalizeChunk(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function getAsyncIterable(input: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  if (typeof (input as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return input as AsyncIterable<Uint8Array>;
  }

  return iterateReadableStream(input as ReadableStream<Uint8Array>);
}

class BytesInputSource implements PreparedInputSource {
  readonly kind = 'bytes' as const;
  readonly replayable = true;
  readonly byteLength: number;
  readonly formatHint?: ImageFormat;
  readonly headerBytes: Uint8Array;
  readonly done = true;

  constructor(private readonly bytes: Uint8Array, formatHint?: ImageFormat) {
    this.byteLength = bytes.byteLength;
    this.headerBytes = bytes.subarray(0, Math.min(bytes.byteLength, INSPECT_TARGETS.at(-1)!));
    this.formatHint = formatHint;
  }

  async ensureHeaderBytes(target: number): Promise<Uint8Array> {
    return this.bytes.subarray(0, Math.min(this.bytes.byteLength, target));
  }

  open(): AsyncIterable<Uint8Array> {
    const bytes = this.bytes;
    return (async function* openBytes() {
      yield bytes;
    })();
  }
}

class StreamInputSource implements PreparedInputSource {
  readonly kind = 'stream' as const;
  readonly replayable = false;
  readonly byteLength?: number;
  readonly formatHint?: ImageFormat;

  private readonly iterator: AsyncIterator<Uint8Array>;
  private peekedChunks: Uint8Array[] = [];
  private peekedBytes = 0;
  private opened = false;
  private exhausted = false;
  headerBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(input: AsyncIterable<Uint8Array>, formatHint?: ImageFormat, byteLength?: number) {
    this.iterator = input[Symbol.asyncIterator]();
    this.formatHint = formatHint;
    this.byteLength = byteLength;
  }

  get done(): boolean {
    return this.exhausted;
  }

  async ensureHeaderBytes(target: number): Promise<Uint8Array> {
    while (!this.exhausted && this.peekedBytes < target) {
      const { value, done } = await this.iterator.next();
      if (done) {
        this.exhausted = true;
        break;
      }

      if (value && value.byteLength > 0) {
        const chunk = normalizeChunk(value);
        this.peekedChunks.push(chunk);
        this.peekedBytes += chunk.byteLength;
      }
    }

    this.headerBytes = concatChunks(this.peekedChunks, this.peekedBytes) as Uint8Array;
    return this.headerBytes;
  }

  open(): AsyncIterable<Uint8Array> {
    if (this.opened) {
      throw new Error('Input source can only be opened once');
    }

    this.opened = true;
    const replay = this.peekedChunks.slice();
    const iterator = this.iterator;

    return (async function* openStream() {
      for (const chunk of replay) {
        yield chunk;
      }

      while (true) {
        const { value, done } = await iterator.next();
        if (done) {
          return;
        }

        if (value && value.byteLength > 0) {
          yield normalizeChunk(value);
        }
      }
    })();
  }
}

function isInputSource(value: ByteInput | InputSource): value is PreparedInputSource {
  return typeof value === 'object' && value !== null && 'open' in value && 'headerBytes' in value;
}

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? normalizeChunk(input) : new Uint8Array(input);
}

async function sourceFromRequestLike(input: Request | Response): Promise<PreparedInputSource> {
  const contentType = input.headers.get('content-type') ?? '';
  const hint = contentType.startsWith('image/') ? (contentType.slice('image/'.length) as ImageFormat) : undefined;
  const lengthHeader = input.headers.get('content-length');
  const byteLength = lengthHeader ? Number(lengthHeader) : undefined;

  if (input.body) {
    return new StreamInputSource(getAsyncIterable(input.body as ReadableStream<Uint8Array>), hint, Number.isFinite(byteLength) ? byteLength : undefined);
  }

  const bytes = new Uint8Array(await input.arrayBuffer());
  return new BytesInputSource(bytes, hint);
}

export async function prepareInputSource(input: ByteInput | InputSource): Promise<PreparedInputSource> {
  if (isInputSource(input)) {
    return input;
  }

  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    return new BytesInputSource(toUint8Array(input));
  }

  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new BytesInputSource(new Uint8Array(await input.arrayBuffer()));
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return sourceFromRequestLike(input);
  }

  if (typeof Response !== 'undefined' && input instanceof Response) {
    return sourceFromRequestLike(input);
  }

  if (typeof ReadableStream !== 'undefined' && input instanceof ReadableStream) {
    return new StreamInputSource(getAsyncIterable(input));
  }

  return new StreamInputSource(getAsyncIterable(input as AsyncIterable<Uint8Array>));
}

export async function inspect(input: ByteInput): Promise<InspectResult> {
  const source = await prepareInputSource(input);
  const info = await inspectSource(source);

  if (info.format === 'unknown') {
    throw new Error('Unsupported image format');
  }

  return { info, source };
}

export async function inspectSource(source: PreparedInputSource): Promise<ImageInfo> {
  let best = probe(source.headerBytes);
  if (best.format !== 'unknown') {
    return best;
  }

  for (const target of INSPECT_TARGETS) {
    const bytes = await source.ensureHeaderBytes(target);
    best = probe(bytes);
    if (best.format !== 'unknown') {
      return best;
    }
  }

  if (source.headerBytes.byteLength === 0) {
    return { format: 'unknown', width: 0, height: 0, hasAlpha: false };
  }

  return probe(source.headerBytes);
}

export async function collectSourceBytes(source: InputSource): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of source.open()) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }

  return concatChunks(chunks, total);
}

export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return sliceArrayBuffer(bytes);
}
