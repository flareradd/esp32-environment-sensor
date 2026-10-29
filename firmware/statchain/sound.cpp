#include "sound.h"
#include "config.h"
#include "dsp.h"
#include "settings.h"
#include "driver/i2s_std.h"

static i2s_chan_handle_t rx = nullptr;
static SoundFilter filter;
static bool ready = false;

static const size_t CHUNK_FRAMES = 512;  // ~10.7 ms of audio at 48 kHz
static int32_t chunk[CHUNK_FRAMES];

enum class State { Idle, Measuring };
static State state = State::Idle;
static uint32_t nextStartMs = 0;
static uint32_t startedMs = 0;
static uint32_t settleLeft = 0;
static uint32_t windowLeft = 0;
static double sumSq = 0;

static const uint32_t SETTLE_FRAMES = (uint64_t)MIC_SAMPLE_RATE * MIC_SETTLE_MS / 1000;
static const uint32_t WINDOW_FRAMES = (uint64_t)MIC_SAMPLE_RATE * SOUND_WINDOW_MS / 1000;
// RMS below this (normalised to full scale) is not a microphone, it's a dead/absent one.
static const float MIN_PLAUSIBLE_RMS = 2e-7f;

bool soundBegin() {
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
  // ~85 ms of buffering so a slow loop() iteration (flash write, Wi-Fi) doesn't overflow the DMA.
  chan.dma_desc_num = 16;
  chan.dma_frame_num = 256;
  if (i2s_new_channel(&chan, nullptr, &rx) != ESP_OK) return false;

  i2s_std_config_t cfg = {};
  cfg.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE);
  // ICS-43434: I2S (Philips) format, 24-bit sample MSB-first inside a 32-bit slot.
  cfg.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
  cfg.slot_cfg.slot_mask = MIC_ON_RIGHT_SLOT ? I2S_STD_SLOT_RIGHT : I2S_STD_SLOT_LEFT;
  cfg.gpio_cfg.mclk = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.bclk = (gpio_num_t)PIN_I2S_BCLK;
  cfg.gpio_cfg.ws = (gpio_num_t)PIN_I2S_WS;
  cfg.gpio_cfg.dout = I2S_GPIO_UNUSED;
  cfg.gpio_cfg.din = (gpio_num_t)PIN_I2S_DIN;
  if (i2s_channel_init_std_mode(rx, &cfg) != ESP_OK) {
    i2s_del_channel(rx);
    rx = nullptr;
    return false;
  }
  soundApplySettings();
  ready = true;
  nextStartMs = millis() + 500;  // first reading shortly after boot
  return true;
}

void soundApplySettings() {
  filter.design(MIC_SAMPLE_RATE, settings.aWeighting);
}

bool soundBusy() { return state == State::Measuring; }

static void finishWindow() {
  i2s_channel_disable(rx);
  state = State::Idle;
}

bool soundUpdate(float* db, bool* valid) {
  if (!ready) return false;
  const uint32_t now = millis();

  if (state == State::Idle) {
    if ((int32_t)(now - nextStartMs) < 0) return false;
    filter.reset();
    settleLeft = SETTLE_FRAMES;
    windowLeft = WINDOW_FRAMES;
    sumSq = 0;
    startedMs = now;
    if (i2s_channel_enable(rx) != ESP_OK) {
      nextStartMs = now + 1000UL * settings.soundIntervalS;
      return false;
    }
    state = State::Measuring;
    return false;
  }

  // Measuring. Safety net: never stay on longer than the window plus generous slack.
  if (now - startedMs > MIC_SETTLE_MS + SOUND_WINDOW_MS + 1500) {
    finishWindow();
    nextStartMs = now + 1000UL * settings.soundIntervalS;
    return false;
  }

  size_t bytes = 0;
  if (i2s_channel_read(rx, chunk, sizeof(chunk), &bytes, 30) != ESP_OK && bytes == 0) return false;

  const size_t frames = bytes / sizeof(int32_t);
  for (size_t i = 0; i < frames && windowLeft > 0; i++) {
    // 24-bit value left-justified in the 32-bit slot; the low 8 bits are not driven by the mic.
    const float x = (float)(chunk[i] >> 8) * (1.0f / 8388608.0f);
    const float y = filter.process(x);
    if (settleLeft > 0) {
      settleLeft--;
      continue;
    }
    sumSq += (double)y * y;
    windowLeft--;
  }
  if (windowLeft > 0) return false;

  finishWindow();
  // Next reading is one interval after this one started, so the cadence doesn't drift.
  nextStartMs = startedMs + 1000UL * settings.soundIntervalS;
  if ((int32_t)(millis() - nextStartMs) > 0) nextStartMs = millis();

  const float rms = sqrtf((float)(sumSq / WINDOW_FRAMES));
  *valid = rms > MIN_PLAUSIBLE_RMS;
  if (!*valid) {
    *db = NAN;
    return true;
  }
  *db = 20.0f * log10f(rms) + micBaseOffsetDb(MIC_SENSITIVITY_DBFS, MIC_REFERENCE_SPL_DB) +
        settings.soundCalDb;
  return true;
}
