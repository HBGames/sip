/**
 * SIP WASM Bindings for libjpeg-turbo and libspng
 *
 * Provides memory-efficient image processing with:
 * - Scaled DCT decoding (1/1, 1/2, 1/4, 1/8) for JPEG
 * - Row-by-row PNG decoding
 * - Scanline-by-scanline processing
 * - Streaming JPEG encoding
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <jpeglib.h>
#include <spng.h>
#include <emscripten.h>

typedef struct SipChunk {
    uint8_t *data;
    uint32_t size;
    struct SipChunk *next;
} SipChunk;

// ============================================================================
// Decoder State
// ============================================================================

typedef struct SipDecoder SipDecoder;

typedef struct {
    struct jpeg_source_mgr pub;
    SipDecoder *owner;
    JOCTET eoi_buffer[2];
} SipDecoderSourceManager;

struct SipDecoder {
    struct jpeg_decompress_struct cinfo;
    struct jpeg_error_mgr jerr;
    JSAMPROW row_buffer;
    SipChunk *input_head;
    SipChunk *input_tail;
    SipChunk *active_input_chunk;
    uint32_t queued_input_bytes;
    uint32_t pending_skip;
    int input_finished;
    SipDecoderSourceManager source_mgr;
    int initialized;
    int header_read;
    int decompressing;
};

// ============================================================================
// Encoder State
// ============================================================================

typedef struct SipEncoder SipEncoder;

typedef struct {
    struct jpeg_destination_mgr pub;
    SipEncoder *owner;
} SipEncoderDestinationManager;

struct SipEncoder {
    struct jpeg_compress_struct cinfo;
    struct jpeg_error_mgr jerr;
    uint8_t *output_buffer;
    uint32_t output_capacity;
    uint32_t total_output_size;
    uint32_t queued_output_bytes;
    SipChunk *output_head;
    SipChunk *output_tail;
    JSAMPROW row_buffer;
    SipEncoderDestinationManager dest_mgr;
    int initialized;
    int compressing;
};

// ============================================================================
// Error Handling
// ============================================================================

static char last_error[256] = "";

static void sip_error_exit(j_common_ptr cinfo) {
    (*cinfo->err->format_message)(cinfo, last_error);
    // Don't call exit() in WASM - return error code instead
}

EMSCRIPTEN_KEEPALIVE
const char* sip_get_error() {
    return last_error;
}

// ============================================================================
// Shared Helpers
// ============================================================================

static void sip_free_chunks(SipChunk **head, SipChunk **tail) {
    SipChunk *chunk = *head;
    while (chunk) {
        SipChunk *next = chunk->next;
        free(chunk->data);
        free(chunk);
        chunk = next;
    }

    *head = NULL;
    *tail = NULL;
}

// ============================================================================
// JPEG Decoder Streaming Source Manager
// ============================================================================

static void sip_decoder_drop_active_chunk(SipDecoder *dec) {
    if (dec->active_input_chunk && dec->source_mgr.pub.bytes_in_buffer == 0) {
        free(dec->active_input_chunk->data);
        free(dec->active_input_chunk);
        dec->active_input_chunk = NULL;
        dec->source_mgr.pub.next_input_byte = NULL;
    }
}

static int sip_decoder_activate_chunk(SipDecoder *dec) {
    sip_decoder_drop_active_chunk(dec);

    if (dec->active_input_chunk) {
        return 1;
    }

    if (!dec->input_head) {
        return 0;
    }

    dec->active_input_chunk = dec->input_head;
    dec->input_head = dec->input_head->next;
    if (!dec->input_head) {
        dec->input_tail = NULL;
    }

    dec->active_input_chunk->next = NULL;
    dec->queued_input_bytes -= dec->active_input_chunk->size;
    dec->source_mgr.pub.next_input_byte = dec->active_input_chunk->data;
    dec->source_mgr.pub.bytes_in_buffer = dec->active_input_chunk->size;
    return 1;
}

static void sip_decoder_init_source(j_decompress_ptr cinfo) {
    SipDecoderSourceManager *src = (SipDecoderSourceManager *)cinfo->src;
    src->pub.bytes_in_buffer = 0;
    src->pub.next_input_byte = NULL;
}

static boolean sip_decoder_fill_input_buffer(j_decompress_ptr cinfo) {
    SipDecoderSourceManager *src = (SipDecoderSourceManager *)cinfo->src;
    SipDecoder *dec = src->owner;

    if (src->pub.bytes_in_buffer == 0 && !sip_decoder_activate_chunk(dec)) {
        if (dec->input_finished) {
            src->eoi_buffer[0] = (JOCTET)0xFF;
            src->eoi_buffer[1] = (JOCTET)JPEG_EOI;
            src->pub.next_input_byte = src->eoi_buffer;
            src->pub.bytes_in_buffer = 2;
        } else {
            return FALSE;
        }
    }

    while (dec->pending_skip > 0) {
        if (src->pub.bytes_in_buffer == 0) {
            if (sip_decoder_activate_chunk(dec)) {
                continue;
            }

            if (dec->input_finished) {
                src->eoi_buffer[0] = (JOCTET)0xFF;
                src->eoi_buffer[1] = (JOCTET)JPEG_EOI;
                src->pub.next_input_byte = src->eoi_buffer;
                src->pub.bytes_in_buffer = 2;
            } else {
                return FALSE;
            }
        }

        if (dec->pending_skip >= src->pub.bytes_in_buffer) {
            dec->pending_skip -= (uint32_t)src->pub.bytes_in_buffer;
            src->pub.next_input_byte += src->pub.bytes_in_buffer;
            src->pub.bytes_in_buffer = 0;
            sip_decoder_drop_active_chunk(dec);
            continue;
        }

        src->pub.next_input_byte += dec->pending_skip;
        src->pub.bytes_in_buffer -= dec->pending_skip;
        dec->pending_skip = 0;
    }

    return TRUE;
}

static void sip_decoder_skip_input_data(j_decompress_ptr cinfo, long num_bytes) {
    if (num_bytes <= 0) {
        return;
    }

    while (num_bytes > (long)cinfo->src->bytes_in_buffer) {
        num_bytes -= (long)cinfo->src->bytes_in_buffer;
        cinfo->src->bytes_in_buffer = 0;

        if (!sip_decoder_fill_input_buffer(cinfo)) {
            SipDecoderSourceManager *src = (SipDecoderSourceManager *)cinfo->src;
            src->owner->pending_skip += (uint32_t)num_bytes;
            return;
        }
    }

    cinfo->src->next_input_byte += num_bytes;
    cinfo->src->bytes_in_buffer -= (size_t)num_bytes;
}

static void sip_decoder_term_source(j_decompress_ptr cinfo) {
    (void)cinfo;
}

// ============================================================================
// JPEG Encoder Streaming Destination Manager
// ============================================================================

static int sip_encoder_queue_chunk(SipEncoder *enc, const uint8_t *data, uint32_t size) {
    if (!size) {
        return 0;
    }

    SipChunk *chunk = (SipChunk *)calloc(1, sizeof(SipChunk));
    if (!chunk) {
        snprintf(last_error, sizeof(last_error), "Failed to allocate encoder chunk");
        return -1;
    }

    chunk->data = (uint8_t *)malloc(size);
    if (!chunk->data) {
        free(chunk);
        snprintf(last_error, sizeof(last_error), "Failed to allocate encoder chunk bytes");
        return -1;
    }

    memcpy(chunk->data, data, size);
    chunk->size = size;

    if (enc->output_tail) {
        enc->output_tail->next = chunk;
    } else {
        enc->output_head = chunk;
    }
    enc->output_tail = chunk;
    enc->queued_output_bytes += size;
    enc->total_output_size += size;

    return 0;
}

static void sip_encoder_init_destination(j_compress_ptr cinfo) {
    SipEncoderDestinationManager *dest = (SipEncoderDestinationManager *)cinfo->dest;
    SipEncoder *enc = dest->owner;
    dest->pub.next_output_byte = enc->output_buffer;
    dest->pub.free_in_buffer = enc->output_capacity;
}

static boolean sip_encoder_empty_output_buffer(j_compress_ptr cinfo) {
    SipEncoderDestinationManager *dest = (SipEncoderDestinationManager *)cinfo->dest;
    SipEncoder *enc = dest->owner;

    if (sip_encoder_queue_chunk(enc, enc->output_buffer, enc->output_capacity) != 0) {
        return FALSE;
    }

    dest->pub.next_output_byte = enc->output_buffer;
    dest->pub.free_in_buffer = enc->output_capacity;
    return TRUE;
}

static void sip_encoder_term_destination(j_compress_ptr cinfo) {
    SipEncoderDestinationManager *dest = (SipEncoderDestinationManager *)cinfo->dest;
    SipEncoder *enc = dest->owner;
    uint32_t used = enc->output_capacity - (uint32_t)dest->pub.free_in_buffer;

    if (used > 0) {
        sip_encoder_queue_chunk(enc, enc->output_buffer, used);
    }
}

// ============================================================================
// Decoder Functions
// ============================================================================

/**
 * Create a new decoder instance
 */
EMSCRIPTEN_KEEPALIVE
SipDecoder* sip_decoder_create() {
    SipDecoder* dec = (SipDecoder*)calloc(1, sizeof(SipDecoder));
    if (!dec) return NULL;

    dec->cinfo.err = jpeg_std_error(&dec->jerr);
    dec->jerr.error_exit = sip_error_exit;

    jpeg_create_decompress(&dec->cinfo);
    dec->source_mgr.owner = dec;
    dec->source_mgr.pub.init_source = sip_decoder_init_source;
    dec->source_mgr.pub.fill_input_buffer = sip_decoder_fill_input_buffer;
    dec->source_mgr.pub.skip_input_data = sip_decoder_skip_input_data;
    dec->source_mgr.pub.resync_to_restart = jpeg_resync_to_restart;
    dec->source_mgr.pub.term_source = sip_decoder_term_source;
    dec->source_mgr.pub.bytes_in_buffer = 0;
    dec->source_mgr.pub.next_input_byte = NULL;
    dec->cinfo.src = (struct jpeg_source_mgr *)&dec->source_mgr;
    dec->initialized = 1;

    return dec;
}

/**
 * Push more input bytes into the decoder
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_push_input(SipDecoder* dec, const uint8_t* data, uint32_t size, int is_final) {
    if (!dec || !dec->initialized) return -1;

    if (size > 0) {
        SipChunk *chunk = (SipChunk *)calloc(1, sizeof(SipChunk));
        if (!chunk) {
            snprintf(last_error, sizeof(last_error), "Failed to allocate decoder input chunk");
            return -1;
        }

        chunk->data = (uint8_t *)malloc(size);
        if (!chunk->data) {
            free(chunk);
            snprintf(last_error, sizeof(last_error), "Failed to allocate decoder input bytes");
            return -1;
        }

        memcpy(chunk->data, data, size);
        chunk->size = size;

        if (dec->input_tail) {
            dec->input_tail->next = chunk;
        } else {
            dec->input_head = chunk;
        }

        dec->input_tail = chunk;
        dec->queued_input_bytes += size;
    }

    if (is_final) {
        dec->input_finished = 1;
    }

    return 0;
}

/**
 * Set full input data for decoder (buffered compatibility helper)
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_set_source(SipDecoder* dec, const uint8_t* data, uint32_t size) {
    if (!dec || !dec->initialized) return -1;
    sip_free_chunks(&dec->input_head, &dec->input_tail);
    sip_decoder_drop_active_chunk(dec);
    dec->queued_input_bytes = 0;
    dec->input_finished = 0;
    dec->pending_skip = 0;
    dec->source_mgr.pub.bytes_in_buffer = 0;
    dec->source_mgr.pub.next_input_byte = NULL;
    return sip_decoder_push_input(dec, data, size, 1);
}

/**
 * Read JPEG header and return dimensions
 * Returns: 0 on success, 1 if more input is needed, -1 on error
 * After success, use sip_decoder_get_width/height to get dimensions
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_read_header(SipDecoder* dec) {
    if (!dec || !dec->initialized) return -1;

    int result = jpeg_read_header(&dec->cinfo, TRUE);
    if (result == JPEG_SUSPENDED) {
        return 1;
    }

    if (result != JPEG_HEADER_OK) {
        return -1;
    }

    dec->header_read = 1;
    return 0;
}

/**
 * Get original image width
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_width(SipDecoder* dec) {
    if (!dec || !dec->header_read) return 0;
    return dec->cinfo.image_width;
}

/**
 * Get original image height
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_height(SipDecoder* dec) {
    if (!dec || !dec->header_read) return 0;
    return dec->cinfo.image_height;
}

/**
 * Set scale factor for DCT-based scaling during decode
 * scale_denom: 1, 2, 4, or 8 (1/1, 1/2, 1/4, 1/8 scale)
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_set_scale(SipDecoder* dec, uint32_t scale_denom) {
    if (!dec || !dec->header_read) return -1;
    if (scale_denom != 1 && scale_denom != 2 && scale_denom != 4 && scale_denom != 8) {
        return -1;
    }

    dec->cinfo.scale_num = 1;
    dec->cinfo.scale_denom = scale_denom;

    // Calculate output dimensions with scaling
    jpeg_calc_output_dimensions(&dec->cinfo);

    return 0;
}

/**
 * Get scaled output width (after set_scale)
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_output_width(SipDecoder* dec) {
    if (!dec || !dec->header_read) return 0;
    return dec->cinfo.output_width;
}

/**
 * Get scaled output height (after set_scale)
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_output_height(SipDecoder* dec) {
    if (!dec || !dec->header_read) return 0;
    return dec->cinfo.output_height;
}

/**
 * Start decompression
 * Must be called after set_scale (or will use 1:1)
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_start(SipDecoder* dec) {
    if (!dec || !dec->header_read) return -1;
    if (dec->decompressing) return 0;

    // Force RGB output
    dec->cinfo.out_color_space = JCS_RGB;

    if (!jpeg_start_decompress(&dec->cinfo)) {
        return 1;
    }

    // Allocate row buffer
    int row_stride = dec->cinfo.output_width * dec->cinfo.output_components;
    dec->row_buffer = (JSAMPROW)malloc(row_stride);
    if (!dec->row_buffer) {
        return -1;
    }

    dec->decompressing = 1;
    return 0;
}

/**
 * Get pointer to internal row buffer
 * Buffer contains RGB data for one scanline after read_scanline
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* sip_decoder_get_row_buffer(SipDecoder* dec) {
    if (!dec || !dec->decompressing) return NULL;
    return dec->row_buffer;
}

/**
 * Read one scanline into internal buffer
 * Returns: 1 if scanline was read, 0 if done, 2 if more input is needed, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_read_scanline(SipDecoder* dec) {
    if (!dec || !dec->decompressing) return -1;

    if (dec->cinfo.output_scanline >= dec->cinfo.output_height) {
        return 0; // Done
    }

    JSAMPROW rows[1] = { dec->row_buffer };
    int lines = jpeg_read_scanlines(&dec->cinfo, rows, 1);

    if (lines > 0) {
        return 1;
    }

    return 2;
}

/**
 * Get current scanline number (0-indexed)
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_scanline(SipDecoder* dec) {
    if (!dec || !dec->decompressing) return 0;
    return dec->cinfo.output_scanline;
}

/**
 * Finish decompression and clean up
 */
EMSCRIPTEN_KEEPALIVE
int sip_decoder_finish(SipDecoder* dec) {
    if (!dec) return -1;

    if (dec->decompressing) {
        if (!jpeg_finish_decompress(&dec->cinfo)) {
            return 1;
        }
        dec->decompressing = 0;
    }

    if (dec->row_buffer) {
        free(dec->row_buffer);
        dec->row_buffer = NULL;
    }

    return 0;
}

EMSCRIPTEN_KEEPALIVE
uint32_t sip_decoder_get_buffered_input_size(SipDecoder* dec) {
    if (!dec) return 0;
    return dec->queued_input_bytes + (uint32_t)dec->source_mgr.pub.bytes_in_buffer;
}

/**
 * Destroy decoder and free all resources
 */
EMSCRIPTEN_KEEPALIVE
void sip_decoder_destroy(SipDecoder* dec) {
    if (!dec) return;

    sip_decoder_finish(dec);

    sip_free_chunks(&dec->input_head, &dec->input_tail);
    sip_decoder_drop_active_chunk(dec);
    dec->queued_input_bytes = 0;

    if (dec->initialized) {
        jpeg_destroy_decompress(&dec->cinfo);
        dec->initialized = 0;
    }

    free(dec);
}

// ============================================================================
// PNG Decoder State
// ============================================================================

typedef struct {
    spng_ctx *ctx;
    uint8_t *row_buffer;
    uint32_t width;
    uint32_t height;
    uint8_t bit_depth;
    uint8_t color_type;
    uint8_t has_alpha;
    uint32_t row_stride;
    uint32_t current_row;
    int initialized;
    int decoding;
} SipPngDecoder;

// ============================================================================
// PNG Decoder Functions
// ============================================================================

/**
 * Create a new PNG decoder instance
 */
EMSCRIPTEN_KEEPALIVE
SipPngDecoder* sip_png_decoder_create() {
    SipPngDecoder* dec = (SipPngDecoder*)calloc(1, sizeof(SipPngDecoder));
    if (!dec) return NULL;

    dec->ctx = spng_ctx_new(0);
    if (!dec->ctx) {
        free(dec);
        return NULL;
    }

    dec->initialized = 1;
    return dec;
}

/**
 * Set input data for PNG decoder
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_set_source(SipPngDecoder* dec, const uint8_t* data, uint32_t size) {
    if (!dec || !dec->initialized) return -1;

    int ret = spng_set_png_buffer(dec->ctx, data, size);
    if (ret != 0) {
        snprintf(last_error, sizeof(last_error), "spng_set_png_buffer failed: %d", ret);
        return -1;
    }

    return 0;
}

/**
 * Read PNG header and parse dimensions
 * Returns: 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_read_header(SipPngDecoder* dec) {
    if (!dec || !dec->initialized) return -1;

    struct spng_ihdr ihdr;
    int ret = spng_get_ihdr(dec->ctx, &ihdr);
    if (ret != 0) {
        snprintf(last_error, sizeof(last_error), "spng_get_ihdr failed: %d", ret);
        return -1;
    }

    dec->width = ihdr.width;
    dec->height = ihdr.height;
    dec->bit_depth = ihdr.bit_depth;
    dec->color_type = ihdr.color_type;

    // Determine if image has alpha
    dec->has_alpha = (ihdr.color_type == SPNG_COLOR_TYPE_GRAYSCALE_ALPHA ||
                      ihdr.color_type == SPNG_COLOR_TYPE_TRUECOLOR_ALPHA);

    return 0;
}

/**
 * Get PNG image width
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_png_decoder_get_width(SipPngDecoder* dec) {
    if (!dec) return 0;
    return dec->width;
}

/**
 * Get PNG image height
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_png_decoder_get_height(SipPngDecoder* dec) {
    if (!dec) return 0;
    return dec->height;
}

/**
 * Check if PNG has alpha channel
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_has_alpha(SipPngDecoder* dec) {
    if (!dec) return 0;
    return dec->has_alpha;
}

/**
 * Start PNG decoding (progressive row-by-row mode)
 * Output format is always RGB (3 bytes per pixel)
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_start(SipPngDecoder* dec) {
    if (!dec || !dec->initialized) return -1;

    // We decode to RGB format (SPNG_FMT_RGB8)
    int ret = spng_decode_image(dec->ctx, NULL, 0, SPNG_FMT_RGB8, SPNG_DECODE_PROGRESSIVE);
    if (ret != 0 && ret != SPNG_EOI) {
        snprintf(last_error, sizeof(last_error), "spng_decode_image init failed: %d", ret);
        return -1;
    }

    // Calculate row stride (RGB = 3 bytes per pixel)
    dec->row_stride = dec->width * 3;

    // Allocate row buffer
    dec->row_buffer = (uint8_t*)malloc(dec->row_stride);
    if (!dec->row_buffer) {
        snprintf(last_error, sizeof(last_error), "Failed to allocate row buffer");
        return -1;
    }

    dec->current_row = 0;
    dec->decoding = 1;

    return 0;
}

/**
 * Get pointer to internal row buffer
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* sip_png_decoder_get_row_buffer(SipPngDecoder* dec) {
    if (!dec || !dec->decoding) return NULL;
    return dec->row_buffer;
}

/**
 * Read one row of PNG data into internal buffer
 * Returns: 1 if row was read, 0 if done, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_read_row(SipPngDecoder* dec) {
    if (!dec || !dec->decoding) return -1;

    if (dec->current_row >= dec->height) {
        return 0; // Done
    }

    struct spng_row_info row_info;
    int ret = spng_get_row_info(dec->ctx, &row_info);
    if (ret != 0 && ret != SPNG_EOI) {
        snprintf(last_error, sizeof(last_error), "spng_get_row_info failed: %d", ret);
        return -1;
    }

    ret = spng_decode_row(dec->ctx, dec->row_buffer, dec->row_stride);
    if (ret != 0 && ret != SPNG_EOI) {
        snprintf(last_error, sizeof(last_error), "spng_decode_row failed: %d", ret);
        return -1;
    }

    dec->current_row++;

    // Return 0 if we've read all rows
    if (dec->current_row >= dec->height || ret == SPNG_EOI) {
        return 0;
    }

    return 1;
}

/**
 * Get current row number (0-indexed)
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_png_decoder_get_row(SipPngDecoder* dec) {
    if (!dec) return 0;
    return dec->current_row;
}

/**
 * Finish PNG decoding
 */
EMSCRIPTEN_KEEPALIVE
int sip_png_decoder_finish(SipPngDecoder* dec) {
    if (!dec) return -1;

    if (dec->row_buffer) {
        free(dec->row_buffer);
        dec->row_buffer = NULL;
    }

    dec->decoding = 0;
    return 0;
}

/**
 * Destroy PNG decoder and free all resources
 */
EMSCRIPTEN_KEEPALIVE
void sip_png_decoder_destroy(SipPngDecoder* dec) {
    if (!dec) return;

    sip_png_decoder_finish(dec);

    if (dec->ctx) {
        spng_ctx_free(dec->ctx);
        dec->ctx = NULL;
    }

    dec->initialized = 0;
    free(dec);
}

// ============================================================================
// Encoder Functions
// ============================================================================

/**
 * Create a new encoder instance
 */
EMSCRIPTEN_KEEPALIVE
SipEncoder* sip_encoder_create() {
    SipEncoder* enc = (SipEncoder*)calloc(1, sizeof(SipEncoder));
    if (!enc) return NULL;

    enc->cinfo.err = jpeg_std_error(&enc->jerr);
    enc->jerr.error_exit = sip_error_exit;

    jpeg_create_compress(&enc->cinfo);
    enc->initialized = 1;

    return enc;
}

/**
 * Initialize encoder with dimensions and quality
 */
EMSCRIPTEN_KEEPALIVE
int sip_encoder_init(SipEncoder* enc, uint32_t width, uint32_t height, int quality) {
    if (!enc || !enc->initialized) return -1;

    enc->output_capacity = 16384;
    enc->output_buffer = (uint8_t *)malloc(enc->output_capacity);
    if (!enc->output_buffer) {
        snprintf(last_error, sizeof(last_error), "Failed to allocate encoder output buffer");
        return -1;
    }

    enc->queued_output_bytes = 0;
    enc->total_output_size = 0;
    sip_free_chunks(&enc->output_head, &enc->output_tail);

    enc->dest_mgr.owner = enc;
    enc->dest_mgr.pub.init_destination = sip_encoder_init_destination;
    enc->dest_mgr.pub.empty_output_buffer = sip_encoder_empty_output_buffer;
    enc->dest_mgr.pub.term_destination = sip_encoder_term_destination;
    enc->cinfo.dest = (struct jpeg_destination_mgr *)&enc->dest_mgr;

    // Set image parameters
    enc->cinfo.image_width = width;
    enc->cinfo.image_height = height;
    enc->cinfo.input_components = 3;  // RGB
    enc->cinfo.in_color_space = JCS_RGB;

    jpeg_set_defaults(&enc->cinfo);
    jpeg_set_quality(&enc->cinfo, quality, TRUE);

    // Allocate row buffer
    enc->row_buffer = (JSAMPROW)malloc(width * 3);
    if (!enc->row_buffer) {
        return -1;
    }

    return 0;
}

/**
 * Start compression
 */
EMSCRIPTEN_KEEPALIVE
int sip_encoder_start(SipEncoder* enc) {
    if (!enc || !enc->initialized) return -1;

    jpeg_start_compress(&enc->cinfo, TRUE);
    enc->compressing = 1;

    return 0;
}

/**
 * Get pointer to internal row buffer for writing
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* sip_encoder_get_row_buffer(SipEncoder* enc) {
    if (!enc || !enc->compressing) return NULL;
    return enc->row_buffer;
}

/**
 * Write one scanline from internal buffer
 * Returns: number of lines written (1), or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int sip_encoder_write_scanline(SipEncoder* enc) {
    if (!enc || !enc->compressing) return -1;

    JSAMPROW rows[1] = { enc->row_buffer };
    return jpeg_write_scanlines(&enc->cinfo, rows, 1);
}

/**
 * Write scanline from provided buffer
 */
EMSCRIPTEN_KEEPALIVE
int sip_encoder_write_scanline_from(SipEncoder* enc, const uint8_t* data) {
    if (!enc || !enc->compressing) return -1;

    JSAMPROW rows[1] = { (JSAMPROW)data };
    return jpeg_write_scanlines(&enc->cinfo, rows, 1);
}

/**
 * Get current scanline number
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_encoder_get_scanline(SipEncoder* enc) {
    if (!enc || !enc->compressing) return 0;
    return enc->cinfo.next_scanline;
}

/**
 * Finish compression
 */
EMSCRIPTEN_KEEPALIVE
int sip_encoder_finish(SipEncoder* enc) {
    if (!enc || !enc->compressing) return -1;

    jpeg_finish_compress(&enc->cinfo);
    enc->compressing = 0;

    return 0;
}

/**
 * Get pointer to output JPEG data
 */
EMSCRIPTEN_KEEPALIVE
uint8_t* sip_encoder_get_output(SipEncoder* enc) {
    (void)enc;
    return NULL;
}

/**
 * Get size of output JPEG data
 */
EMSCRIPTEN_KEEPALIVE
uint32_t sip_encoder_get_output_size(SipEncoder* enc) {
    if (!enc) return 0;
    return enc->total_output_size;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* sip_encoder_peek_chunk_data(SipEncoder* enc) {
    if (!enc || !enc->output_head) return NULL;
    return enc->output_head->data;
}

EMSCRIPTEN_KEEPALIVE
uint32_t sip_encoder_peek_chunk_size(SipEncoder* enc) {
    if (!enc || !enc->output_head) return 0;
    return enc->output_head->size;
}

EMSCRIPTEN_KEEPALIVE
int sip_encoder_pop_chunk(SipEncoder* enc) {
    if (!enc || !enc->output_head) return 0;

    SipChunk *chunk = enc->output_head;
    enc->output_head = chunk->next;
    if (!enc->output_head) {
        enc->output_tail = NULL;
    }

    enc->queued_output_bytes -= chunk->size;
    free(chunk->data);
    free(chunk);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
uint32_t sip_encoder_get_buffered_output_size(SipEncoder* enc) {
    if (!enc) return 0;
    return enc->queued_output_bytes;
}

/**
 * Destroy encoder and free all resources
 */
EMSCRIPTEN_KEEPALIVE
void sip_encoder_destroy(SipEncoder* enc) {
    if (!enc) return;

    if (enc->compressing) {
        // Don't call finish if we're aborting
        enc->compressing = 0;
    }

    if (enc->row_buffer) {
        free(enc->row_buffer);
        enc->row_buffer = NULL;
    }

    if (enc->output_buffer) {
        free(enc->output_buffer);
        enc->output_buffer = NULL;
    }

    sip_free_chunks(&enc->output_head, &enc->output_tail);
    enc->queued_output_bytes = 0;
    enc->total_output_size = 0;

    if (enc->initialized) {
        jpeg_destroy_compress(&enc->cinfo);
        enc->initialized = 0;
    }

    free(enc);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Allocate memory that can be accessed from JS
 */
EMSCRIPTEN_KEEPALIVE
void* sip_malloc(uint32_t size) {
    return malloc(size);
}

/**
 * Free memory allocated with sip_malloc
 */
EMSCRIPTEN_KEEPALIVE
void sip_free(void* ptr) {
    free(ptr);
}
