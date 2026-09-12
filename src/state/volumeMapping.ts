/** Map amplifier volume (e.g. 0–30) to HomeKit/CEC percent (0–100). */
export function ampVolumeToPercent(ampVolume: number, ampMax = 100, ampMin = 0): number {
  const span = Math.max(1, ampMax - ampMin);
  const clamped = Math.min(ampMax, Math.max(ampMin, ampVolume));
  return Math.round(((clamped - ampMin) / span) * 100);
}

/** Map HomeKit/CEC percent (0–100) to amplifier volume. */
export function percentToAmpVolume(percent: number, ampMax = 100, ampMin = 0): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.round(ampMin + (clamped / 100) * (ampMax - ampMin));
}
