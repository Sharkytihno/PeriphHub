/**
 * Shared keyboard status shape. Deliberately NOT MouseStatus: keyboards have
 * no DPI, polling rate, lift-off distance or battery-vs-wired mouse fields,
 * and stuffing them into the mouse grid is what made the old shim drivers
 * report `dpi: 0` / `pollingRateHz: 0` placeholder noise.
 */
export {};
