// What the device measures, and where each measurement lives in an archived log row.
//
// A row is [t, temp, hum, press, snd, sndMin, sndMax, batt] - the same column order as the
// device's CSV, with empty fields as null.

export const COLS = ['t', 'temp', 'hum', 'press', 'snd', 'sndMin', 'sndMax', 'batt'];
export const CSV_HEADER = 'epoch,tempC,humidity,pressureHPa,soundAvg,soundMin,soundMax,battMv';

export const METRICS = [
  { id: 'temp', label: 'Temperature', unit: '°C', dec: 1, col: 1, minSpan: 2 },
  { id: 'hum', label: 'Humidity', unit: '%', dec: 0, col: 2, minSpan: 10 },
  { id: 'press', label: 'Pressure', unit: 'hPa', dec: 0, col: 3, minSpan: 4 },
  // Sound is a level in dB: averaged on energy, and each log line also carries its own min/max.
  { id: 'sound', label: 'Sound level', unit: 'dB', dec: 0, col: 4, minCol: 5, maxCol: 6, energy: true, minSpan: 20 },
];

export const metricById = (id) => METRICS.find((m) => m.id === id);
