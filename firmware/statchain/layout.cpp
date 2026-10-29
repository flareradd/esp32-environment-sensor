#include "layout.h"
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>

// Same values as GxEPD_BLACK / GxEPD_WHITE / GxEPD_RED. Red is a warning colour only.
static const uint16_t BLACK = 0x0000, WHITE = 0xFFFF, RED = 0xF800;

// Text is positioned by baseline, like all Adafruit GFX fonts.
static int16_t textWidth(Adafruit_GFX& g, const char* s) {
  int16_t x1, y1;
  uint16_t w, h;
  g.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return w;
}

static void drawText(Adafruit_GFX& g, const char* s, int16_t x, int16_t baseline, const GFXfont* f,
                     uint16_t color) {
  g.setFont(f);
  g.setTextColor(color);
  g.setCursor(x, baseline);
  g.print(s);
}

static void drawCentered(Adafruit_GFX& g, const char* s, int16_t cx, int16_t baseline, const GFXfont* f,
                         uint16_t color) {
  g.setFont(f);
  drawText(g, s, cx - textWidth(g, s) / 2, baseline, f, color);
}

static void drawRightAligned(Adafruit_GFX& g, const char* s, int16_t right, int16_t baseline,
                             const GFXfont* f, uint16_t color) {
  g.setFont(f);
  drawText(g, s, right - textWidth(g, s), baseline, f, color);
}

// The bundled GFX fonts are ASCII only, so the degree sign is a small ring.
static void drawTempUnit(Adafruit_GFX& g, int16_t cx, int16_t baseline) {
  g.setFont(&FreeSans9pt7b);
  const int16_t total = 6 + textWidth(g, "C");
  const int16_t x = cx - total / 2;
  g.drawCircle(x + 2, baseline - 9, 2, BLACK);
  drawText(g, "C", x + 6, baseline, &FreeSans9pt7b, BLACK);
}

static void drawBattery(Adafruit_GFX& g, int16_t x, int16_t y, uint8_t pct, bool low) {
  const uint16_t color = low ? RED : BLACK;
  g.drawRect(x, y, 24, 11, color);
  g.fillRect(x + 24, y + 3, 2, 5, color);
  int16_t fill = (int16_t)(pct * 20 / 100);
  if (fill < 1 && pct > 0) fill = 1;
  g.fillRect(x + 2, y + 2, fill, 7, color);
}

//   title row / three readings / sound row / footer
void renderPage(Adafruit_GFX& g, const ScreenData& d) {
  char buf[40];
  g.fillScreen(WHITE);

  // Title
  drawText(g, "Your Environment", 4, 14, &FreeSansBold9pt7b, BLACK);
  g.drawFastHLine(0, 17, 250, BLACK);

  // Three columns: temperature, humidity, pressure
  const int16_t cx[3] = {42, 125, 208};
  const char* labels[3] = {"Temp", "Humidity", "Pressure"};
  for (int i = 0; i < 3; i++) drawCentered(g, labels[i], cx[i], 32, &FreeSans9pt7b, BLACK);
  g.drawFastVLine(84, 20, 52, BLACK);
  g.drawFastVLine(167, 20, 52, BLACK);

  if (isnan(d.now.tempC)) snprintf(buf, sizeof buf, "--");
  else snprintf(buf, sizeof buf, "%.1f", d.now.tempC);
  drawCentered(g, buf, cx[0], 54, &FreeSansBold12pt7b, BLACK);
  drawTempUnit(g, cx[0], 69);

  if (isnan(d.now.humidity)) snprintf(buf, sizeof buf, "--");
  else snprintf(buf, sizeof buf, "%.0f", d.now.humidity);
  drawCentered(g, buf, cx[1], 54, &FreeSansBold12pt7b, BLACK);
  drawCentered(g, "%", cx[1], 69, &FreeSans9pt7b, BLACK);

  if (isnan(d.now.pressureHPa)) snprintf(buf, sizeof buf, "--");
  else snprintf(buf, sizeof buf, "%.0f", d.now.pressureHPa);
  drawCentered(g, buf, cx[2], 54, &FreeSansBold12pt7b, BLACK);
  drawCentered(g, "hPa", cx[2], 69, &FreeSans9pt7b, BLACK);

  g.drawFastHLine(0, 73, 250, BLACK);

  // Sound row: current level on the left, today's min / max stacked on the right
  const bool loud = !isnan(d.now.soundDb) && d.now.soundDb >= d.loudDb;
  drawText(g, "Sound", 4, 96, &FreeSans9pt7b, BLACK);
  if (isnan(d.now.soundDb)) snprintf(buf, sizeof buf, "--");
  else snprintf(buf, sizeof buf, "%.0f dB", d.now.soundDb);
  drawText(g, buf, 62, 96, &FreeSansBold12pt7b, loud ? RED : BLACK);
  if (!isnan(d.soundMin) && !isnan(d.soundMax)) {
    snprintf(buf, sizeof buf, "min %.0f", d.soundMin);
    drawRightAligned(g, buf, 246, 88, &FreeSans9pt7b, BLACK);
    snprintf(buf, sizeof buf, "max %.0f", d.soundMax);
    drawRightAligned(g, buf, 246, 102, &FreeSans9pt7b, BLACK);
  }

  g.drawFastHLine(0, 106, 250, BLACK);

  // Footer: battery left, time of this refresh right
  const bool low = d.now.battValid && d.now.battPct <= d.battLowPct;
  if (d.now.battValid) {
    drawBattery(g, 4, 110, d.now.battPct, low);
    snprintf(buf, sizeof buf, "%u%%", d.now.battPct);
    drawText(g, buf, 34, 120, &FreeSans9pt7b, low ? RED : BLACK);
  } else {
    drawText(g, "Batt --", 4, 120, &FreeSans9pt7b, BLACK);
  }
  if (d.epoch > 0) {
    struct tm t;
    localtime_r(&d.epoch, &t);
    strftime(buf, sizeof buf, "%a %d %b  %H:%M", &t);
  } else {
    snprintf(buf, sizeof buf, "--:--");
  }
  drawRightAligned(g, buf, 246, 120, &FreeSans9pt7b, BLACK);
}
