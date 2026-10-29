// Sound-level DSP: biquad filters and the A-weighting curve.
// Deliberately free of Arduino/ESP headers so it can be unit-tested on a PC.
#pragma once
#include <math.h>
#include <stdint.h>

struct Biquad {
  // Transposed direct form II. Coefficients are normalised so a0 == 1.
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  float z1 = 0, z2 = 0;

  inline float process(float x) {
    float y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  }
  void reset() { z1 = z2 = 0; }
};

// Bilinear transform of an analog section
//   (n2 s^2 + n1 s + n0) / (d2 s^2 + d1 s + d0)
// sampled at fs. Computed in double (one-off at start-up), stored as float.
inline Biquad biquadFromAnalog(double n2, double n1, double n0,
                               double d2, double d1, double d0, double fs) {
  const double c = 2.0 * fs, c2 = c * c;
  const double a0 = d2 * c2 + d1 * c + d0;
  Biquad q;
  q.b0 = (float)((n2 * c2 + n1 * c + n0) / a0);
  q.b1 = (float)((2.0 * n0 - 2.0 * n2 * c2) / a0);
  q.b2 = (float)((n2 * c2 - n1 * c + n0) / a0);
  q.a1 = (float)((2.0 * d0 - 2.0 * d2 * c2) / a0);
  q.a2 = (float)((d2 * c2 - d1 * c + d0) / a0);
  return q;
}

// Magnitude response of a biquad at frequency f (Hz), as a linear gain.
inline double biquadGain(const Biquad& q, double f, double fs) {
  const double w = 2.0 * M_PI * f / fs;
  const double c1 = cos(w), s1 = sin(w), c2 = cos(2 * w), s2 = sin(2 * w);
  const double nr = q.b0 + q.b1 * c1 + q.b2 * c2, ni = -(q.b1 * s1 + q.b2 * s2);
  const double dr = 1.0 + q.a1 * c1 + q.a2 * c2, di = -(q.a1 * s1 + q.a2 * s2);
  return sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}

// IEC 61672 A-weighting as three cascaded sections, plus a gain that makes the
// whole chain 0 dB at 1 kHz. Section 0 on its own (a 20.6 Hz double high-pass)
// doubles as the DC blocker for an unweighted ("flat") reading.
struct SoundFilter {
  static const int SECTIONS = 3;
  Biquad sec[SECTIONS];
  float gain = 1.0f;
  bool aWeighted = true;

  void design(double fs, bool aWeight) {
    const double f1 = 20.598997, f2 = 107.65265, f3 = 737.86223, f4 = 12194.217;
    const double w1 = 2 * M_PI * f1, w2 = 2 * M_PI * f2, w3 = 2 * M_PI * f3, w4 = 2 * M_PI * f4;
    aWeighted = aWeight;
    sec[0] = biquadFromAnalog(1, 0, 0, 1, 2 * w1, w1 * w1, fs);        // s^2 / (s+w1)^2
    sec[1] = biquadFromAnalog(1, 0, 0, 1, w2 + w3, w2 * w3, fs);       // s^2 / ((s+w2)(s+w3))
    sec[2] = biquadFromAnalog(0, 0, w4 * w4, 1, 2 * w4, w4 * w4, fs);  // w4^2 / (s+w4)^2
    const int n = aWeight ? SECTIONS : 1;
    double g = 1.0;
    for (int i = 0; i < n; i++) g *= biquadGain(sec[i], 1000.0, fs);
    gain = (float)(1.0 / g);
  }

  void reset() {
    for (int i = 0; i < SECTIONS; i++) sec[i].reset();
  }

  inline float process(float x) {
    x = sec[0].process(x);
    if (aWeighted) {
      x = sec[1].process(x);
      x = sec[2].process(x);
    }
    return x * gain;
  }
};

// Reference level for a 24-bit microphone, from its datasheet figures.
// A full-scale sine has RMS 1/sqrt(2) of full scale (0 dBFS); a mic rated
// sensSpl SPL -> sensDbfs dBFS therefore gives, for a normalised RMS r:
//   SPL = 20*log10(r) + 10*log10(2) + (sensSpl - sensDbfs)
inline float micBaseOffsetDb(float sensDbfs, float sensSpl) {
  return 3.0103f + (sensSpl - sensDbfs);
}
