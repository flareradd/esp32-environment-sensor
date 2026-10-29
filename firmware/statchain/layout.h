// The "Your Environment" page, drawn onto any Adafruit_GFX canvas (250 x 122, landscape).
// Kept apart from the panel driver so the layout can be rendered and checked on a PC.
#pragma once
#include <Adafruit_GFX.h>
#include "screen.h"

void renderPage(Adafruit_GFX& g, const ScreenData& data);
