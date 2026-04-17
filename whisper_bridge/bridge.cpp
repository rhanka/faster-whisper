#include "bridge.h"
#include <ctranslate2/models/whisper.h>
#include <iostream>
#include <vector>
#include <cmath>
#include <complex>
#include <string>
#include <nlohmann/json.hpp>
#include "pocketfft_hdronly.h"

namespace {

ctranslate2::StorageView make_features_storage(
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length
) {
    std::vector<ctranslate2::dim_t> shape = {
        static_cast<ctranslate2::dim_t>(batch_size),
        static_cast<ctranslate2::dim_t>(n_mels),
        static_cast<ctranslate2::dim_t>(chunk_length)
    };

    ctranslate2::StorageView features(shape, ctranslate2::DataType::FLOAT32);
    std::copy(features_data, features_data + (batch_size * n_mels * chunk_length), features.data<float>());
    return features;
}

char* copy_json_string(const nlohmann::json& json) {
    static thread_local std::string serialized;
    serialized = json.dump();
    return serialized.data();
}

}

extern "C" {

WhisperModelHandle whisper_init(const char* model_path, const char* device, int device_index, const char* compute_type) {
    try {
        ctranslate2::ComputeType ctype = ctranslate2::ComputeType::DEFAULT;
        std::string ct(compute_type);
        if (ct == "float16") ctype = ctranslate2::ComputeType::FLOAT16;
        else if (ct == "int8") ctype = ctranslate2::ComputeType::INT8;
        else if (ct == "int8_float16") ctype = ctranslate2::ComputeType::INT8_FLOAT16;
        else if (ct == "int16") ctype = ctranslate2::ComputeType::INT16;
        else if (ct == "float32") ctype = ctranslate2::ComputeType::FLOAT32;

        ctranslate2::Device dev = ctranslate2::Device::CPU;
        std::string d(device);
        if (d == "cuda") dev = ctranslate2::Device::CUDA;

        ctranslate2::ReplicaPoolConfig config;
        config.num_threads_per_replica = 1;

        auto* model = new ctranslate2::models::Whisper(
            model_path,
            dev,
            ctype,
            {device_index},
            false,
            config
        );
        return static_cast<WhisperModelHandle>(model);
    } catch (const std::exception& e) {
        std::cerr << "Error initializing Whisper model: " << e.what() << std::endl;
        return nullptr;
    }
}

void whisper_free(WhisperModelHandle handle) {
    if (handle) {
        auto* model = static_cast<ctranslate2::models::Whisper*>(handle);
        delete model;
    }
}

WhisperResult* whisper_generate(
    WhisperModelHandle handle,
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length,
    const int* prompt_data_flat,
    const size_t* prompt_lengths,
    const WhisperOptions* options
) {
    try {
        auto* model = static_cast<ctranslate2::models::Whisper*>(handle);

        ctranslate2::StorageView features = make_features_storage(features_data, batch_size, n_mels, chunk_length);

        // Prepare prompts
        std::vector<std::vector<size_t>> int_prompts(batch_size);
        size_t prompt_offset = 0;
        for (size_t i = 0; i < batch_size; ++i) {
            for (size_t j = 0; j < prompt_lengths[i]; ++j) {
                size_t token = static_cast<size_t>(prompt_data_flat[prompt_offset++]);
                int_prompts[i].push_back(token);
            }
        }

        ctranslate2::models::WhisperOptions ct_options;
        // ... (keep rest of options setup)
        ct_options.beam_size = options->beam_size;
        ct_options.patience = options->patience;
        ct_options.length_penalty = options->length_penalty;
        ct_options.repetition_penalty = options->repetition_penalty;
        ct_options.no_repeat_ngram_size = options->no_repeat_ngram_size;
        ct_options.max_length = options->max_length;
        ct_options.return_scores = options->return_scores;
        ct_options.return_no_speech_prob = options->return_no_speech_prob;
        ct_options.max_initial_timestamp_index = options->max_initial_timestamp_index;
        ct_options.suppress_blank = options->suppress_blank;
        
        if (options->suppress_tokens_length > 0 && options->suppress_tokens != nullptr) {
            for (size_t i = 0; i < options->suppress_tokens_length; ++i) {
                ct_options.suppress_tokens.push_back(options->suppress_tokens[i]);
            }
        } else if (options->suppress_tokens_length == 1 && options->suppress_tokens[0] == -1) {
            ct_options.suppress_tokens = {-1};
        }

        ct_options.sampling_topk = options->sampling_topk;
        ct_options.sampling_temperature = options->sampling_temperature;

        // Generate
        auto futures = model->generate(features, int_prompts, ct_options);
        auto result = futures[0].get();

        WhisperResult* res = new WhisperResult();
        res->num_sequences = result.sequences.size();
        res->sequences = new int*[res->num_sequences];
        res->sequences_lengths = new size_t[res->num_sequences];
        res->scores = new float[res->num_sequences];
        res->no_speech_prob = result.no_speech_prob;

        for (size_t i = 0; i < res->num_sequences; ++i) {
            const auto& seq = result.sequences_ids[i];
            res->sequences_lengths[i] = seq.size();
            res->sequences[i] = new int[seq.size()];
            for (size_t j = 0; j < seq.size(); ++j) {
                res->sequences[i][j] = static_cast<int>(seq[j]);
            }
            if (options->return_scores && i < result.scores.size()) {
                res->scores[i] = result.scores[i];
            } else {
                res->scores[i] = 0.0f;
            }
        }

        return res;

    } catch (const std::exception& e) {
        std::cerr << "Error in whisper_generate: " << e.what() << std::endl;
        return nullptr;
    }
}

void whisper_free_result(WhisperResult* result) {
    if (result) {
        for (size_t i = 0; i < result->num_sequences; ++i) {
            delete[] result->sequences[i];
        }
        delete[] result->sequences;
        delete[] result->sequences_lengths;
        delete[] result->scores;
        delete result;
    }
}

char* whisper_detect_language_json(
    WhisperModelHandle handle,
    const float* features_data,
    size_t batch_size,
    size_t n_mels,
    size_t chunk_length
) {
    try {
        auto* model = static_cast<ctranslate2::models::Whisper*>(handle);
        ctranslate2::StorageView features = make_features_storage(features_data, batch_size, n_mels, chunk_length);
        auto encoder_output = model->encode(features, false).get();
        auto futures = model->detect_language(encoder_output);

        nlohmann::json payload = nlohmann::json::array();
        for (auto& future : futures) {
            nlohmann::json batch_result = nlohmann::json::array();
            for (const auto& item : future.get()) {
                batch_result.push_back({item.first, item.second});
            }
            payload.push_back(batch_result);
        }

        return copy_json_string(payload);
    } catch (const std::exception& e) {
        std::cerr << "Error in whisper_detect_language_json: " << e.what() << std::endl;
        return nullptr;
    }
}

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
) {
    try {
        auto* model = static_cast<ctranslate2::models::Whisper*>(handle);
        ctranslate2::StorageView features = make_features_storage(features_data, batch_size, n_mels, chunk_length);
        auto encoder_output = model->encode(features, false).get();

        std::vector<size_t> start_sequence_ids;
        start_sequence_ids.reserve(start_sequence_length);
        for (size_t i = 0; i < start_sequence_length; ++i) {
            start_sequence_ids.push_back(static_cast<size_t>(start_sequence[i]));
        }

        std::vector<std::vector<size_t>> text_tokens;
        text_tokens.reserve(text_count);
        size_t token_offset = 0;
        for (size_t i = 0; i < text_count; ++i) {
            std::vector<size_t> tokens;
            tokens.reserve(text_token_lengths[i]);
            for (size_t j = 0; j < text_token_lengths[i]; ++j) {
                tokens.push_back(static_cast<size_t>(text_tokens_flat[token_offset++]));
            }
            text_tokens.push_back(std::move(tokens));
        }

        std::vector<size_t> frame_counts;
        frame_counts.reserve(text_count);
        for (size_t i = 0; i < text_count; ++i) {
            frame_counts.push_back(num_frames[i]);
        }

        auto futures = model->align(
            encoder_output,
            start_sequence_ids,
            text_tokens,
            frame_counts,
            static_cast<ctranslate2::dim_t>(median_filter_width)
        );

        nlohmann::json payload = nlohmann::json::array();
        for (auto& future : futures) {
            const auto result = future.get();
            nlohmann::json item;
            item["alignments"] = nlohmann::json::array();
            for (const auto& pair : result.alignments) {
                item["alignments"].push_back({pair.first, pair.second});
            }
            item["text_token_probs"] = result.text_token_probs;
            payload.push_back(item);
        }

        return copy_json_string(payload);
    } catch (const std::exception& e) {
        std::cerr << "Error in whisper_align_json: " << e.what() << std::endl;
        return nullptr;
    }
}

void whisper_free_string(char* value) {
    (void)value;
}

void compute_mel_spectrogram(
    const float* waveform,
    size_t waveform_length,
    float* out_features,
    size_t expected_frames,
    size_t n_mels,
    size_t n_fft,
    size_t hop_length,
    const float* mel_filters
) {
    std::vector<float> window(n_fft);
    for (size_t i = 0; i < n_fft; ++i) {
        window[i] = 0.5f * (1.0f - std::cos(2.0f * M_PI * i / n_fft));
    }

    size_t pad_amount = n_fft / 2;
    size_t padded_length = waveform_length + 2 * pad_amount;
    std::vector<float> padded_waveform(padded_length, 0.0f);
    
    for (size_t i = 0; i < pad_amount; ++i) {
        if (i < waveform_length) {
            padded_waveform[pad_amount - 1 - i] = waveform[i + 1];
        }
    }
    for (size_t i = 0; i < waveform_length; ++i) {
        padded_waveform[pad_amount + i] = waveform[i];
    }
    for (size_t i = 0; i < pad_amount; ++i) {
        if (waveform_length >= 2 && i < waveform_length - 1) {
            padded_waveform[pad_amount + waveform_length + i] = waveform[waveform_length - 2 - i];
        }
    }

    size_t n_frames = 1 + (padded_length - n_fft) / hop_length;
    size_t frames_to_compute = std::min(n_frames, expected_frames);
    
    std::vector<float> log_spec(expected_frames * n_mels, 0.0f);
    float global_max = -1e10f;

    pocketfft::shape_t shape = {n_fft};
    pocketfft::stride_t stride = {sizeof(float)};
    pocketfft::shape_t axes = {0};
    
    std::vector<float> in_frame(n_fft);
    std::vector<std::complex<float>> out_fft(n_fft / 2 + 1);

    for (size_t i = 0; i < frames_to_compute; ++i) {
        size_t start = i * hop_length;
        for (size_t j = 0; j < n_fft; ++j) {
            in_frame[j] = padded_waveform[start + j] * window[j];
        }

        pocketfft::stride_t stride_out = {sizeof(std::complex<float>)};
        pocketfft::r2c(shape, stride, stride_out, axes, pocketfft::FORWARD, in_frame.data(), out_fft.data(), 1.0f);

        for (size_t m = 0; m < n_mels; ++m) {
            float mel_val = 0.0f;
            for (size_t j = 0; j < n_fft / 2; ++j) {
                float mag_sq = std::norm(out_fft[j]);
                mel_val += mel_filters[m * (n_fft / 2 + 1) + j] * mag_sq;
            }
            
            float val = std::log10(std::max(mel_val, 1e-10f));
            if (val > global_max) global_max = val;
            log_spec[m * expected_frames + i] = val;
        }
    }

    float clip_val = global_max - 8.0f;
    for (size_t i = 0; i < expected_frames * n_mels; ++i) {
        float val = log_spec[i];
        val = std::max(val, clip_val);
        out_features[i] = (val + 4.0f) / 4.0f;
    }
}

}
