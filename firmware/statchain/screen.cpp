#include "screen.h"
#include "config.h"
#include "layout.h"
#include <SPI.h>
#include <GxEPD2_3C.h>

// WeAct 2.13" b/w/r, 122x250, SSD1680. One full-height page = the whole frame in RAM (~8 KB).
static GxEPD2_3C<GxEPD2_213_Z98c, GxEPD2_213_Z98c::HEIGHT> epd(
    GxEPD2_213_Z98c(PIN_EPD_CS, PIN_EPD_DC, PIN_EPD_RST, PIN_EPD_BUSY));

static TaskHandle_t task = nullptr;
static SemaphoreHandle_t lock = nullptr;
static ScreenData pending;
static volatile bool drawing = false;

static void drawTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    ScreenData d;
    xSemaphoreTake(lock, portMAX_DELAY);
    d = pending;
    xSemaphoreGive(lock);

    epd.setFullWindow();
    epd.firstPage();
    do {
      renderPage(epd, d);
    } while (epd.nextPage());  // blocks ~15 s on the panel's BUSY line; other tasks keep running
    epd.hibernate();           // panel to deep sleep: holds the image with no power draw

    drawing = false;
  }
}

void screenBegin() {
  lock = xSemaphoreCreateMutex();
  SPI.begin(PIN_EPD_SCK, -1, PIN_EPD_MOSI, PIN_EPD_CS);
  epd.epd2.selectSPI(SPI, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  epd.init(0);
  epd.setRotation(EPD_ROTATION);
  xTaskCreate(drawTask, "epd", 8192, nullptr, 1, &task);
}

bool screenRequest(const ScreenData& data) {
  if (drawing || !task) return false;
  xSemaphoreTake(lock, portMAX_DELAY);
  pending = data;
  xSemaphoreGive(lock);
  drawing = true;
  xTaskNotifyGive(task);
  return true;
}

bool screenBusy() { return drawing; }
