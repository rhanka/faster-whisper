#ifndef WHISPER_BRIDGE_H
#define WHISPER_BRIDGE_H

#include <stddef.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* WhisperModelHandle;

WhisperModelHandle whisper_init(const char* model_path, const char* device, int device_index, const char* compute_type);
void whisper_free(WhisperModelHandle handle);

typedef struct {
    int beam_size;
    float patience;
    int num_hypotheses;
    float length_penalty;
    float repetition_penalty;
    int no_repeat_ngram_size;
    int max_length;
    bool return_scores;
    bool return_no_speech_prob;
    int max_initial_timestamp_index;
    bool suppress_blank;
    const int* suppress_tokens;
    size_t suppress_tokens_length;
    int sampling_topk;
    float sampling_temperature;
} WhisperOptions;

typedef struct {
    int** sequences; // [num_sequences][seq_len]
    size_t* sequences_lengths;
    size_t num_sequences;
    float* scores;
    float no_speech_prob;
} WhisperResult;

WhisperResult* whisper_generate(
    WhisperModelHandle handle,
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length,
    const int* prompt_data_flat, // flattened [batch_size * prompt_length] (or sum of lengths)
    const size_t* prompt_lengths, // [batch_size]
    const WhisperOptions* options
);

void whisper_free_result(WhisperResult* result);

char* whisper_detect_language_json(
    WhisperModelHandle handle,
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length
);

char* whisper_align_json(
    WhisperModelHandle handle,
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length,
    const int* start_sequence,
    size_t start_sequence_length,
    const int* text_tokens_flat,
    const size_t* text_token_lengths,
    size_t text_count,
    const size_t* num_frames,
    size_t median_filter_width
);

void whisper_free_string(char* value);

// Mel Spectrogram computation in C++
void compute_mel_spectrogram(
    const float* waveform,
    size_t waveform_length,
    float* out_features, // pre-allocated, size: n_mels * expected_frames
    size_t expected_frames,
    size_t n_mels,
    size_t n_fft,
    size_t hop_length,
    const float* mel_filters // pre-computed mel filters [n_mels * (n_fft/2 + 1)]
);

#ifdef __cplusplus
}
#endif

#endif // WHISPER_BRIDGE_H
