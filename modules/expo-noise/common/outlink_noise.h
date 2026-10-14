#ifndef OUTLINK_NOISE_H
#define OUTLINK_NOISE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OutlinkNoiseHandshake OutlinkNoiseHandshake;
typedef struct OutlinkNoiseSession OutlinkNoiseSession;

enum {
  OUTLINK_NOISE_OK = 0,
  OUTLINK_NOISE_INVALID_ARGUMENT = 1,
  OUTLINK_NOISE_INVALID_STATE = 2,
  OUTLINK_NOISE_CRYPTO_ERROR = 3,
  OUTLINK_NOISE_BUFFER_TOO_SMALL = 4,
  OUTLINK_NOISE_PAYLOAD_TOO_LARGE = 5,
  OUTLINK_NOISE_SESSION_EXPIRED = 6,
  OUTLINK_NOISE_AUTH_FAILED = 7,
};

int outlink_noise_keypair(
    const uint8_t *private_key,
    size_t private_key_len,
    uint8_t out_private_key[32],
    uint8_t out_public_key[32]);

int outlink_noise_handshake_create(
    int initiator,
    const uint8_t *static_private_key,
    size_t static_private_key_len,
    const uint8_t *fixed_ephemeral_private_key,
    size_t fixed_ephemeral_private_key_len,
    OutlinkNoiseHandshake **out_handshake);

int outlink_noise_handshake_write(
    OutlinkNoiseHandshake *handshake,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int outlink_noise_handshake_read(
    OutlinkNoiseHandshake *handshake,
    const uint8_t *message,
    size_t message_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int outlink_noise_handshake_remote_static(
    OutlinkNoiseHandshake *handshake,
    uint8_t output[32]);

int outlink_noise_handshake_finish(
    OutlinkNoiseHandshake *handshake,
    size_t max_record_size,
    OutlinkNoiseSession **out_session,
    uint8_t out_session_id[32]);

void outlink_noise_handshake_destroy(OutlinkNoiseHandshake *handshake);

int outlink_noise_session_should_rotate(
    OutlinkNoiseSession *session,
    size_t next_payload_len,
    int *out_should_rotate);

int outlink_noise_session_seal(
    OutlinkNoiseSession *session,
    uint8_t packet_type,
    const uint8_t *payload,
    size_t payload_len,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

int outlink_noise_session_open(
    OutlinkNoiseSession *session,
    const uint8_t *record,
    size_t record_len,
    uint8_t *out_packet_type,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_len);

void outlink_noise_session_destroy(OutlinkNoiseSession *session);

const char *outlink_noise_error_message(int error);

#ifdef __cplusplus
}
#endif

#endif
