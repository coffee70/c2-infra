/**
 * Format a numeric value with smart precision based on magnitude and units.
 * Avoids fixed 4 decimals; shows meaningful digits per unit type.
 */
export function formatSmartValue(
  value: number,
  units: string | null | undefined
): string {
  const abs = Math.abs(value);
  const displayUnit = !units?.trim() ? "" : units === "C" ? "°C" : ` ${units}`;

  // Scientific notation for very small or very large values
  if (abs > 0 && (abs < 0.001 || abs >= 1e6)) {
    const exp = value.toExponential(2);
    return `${exp}${displayUnit}`;
  }

  // Unit-specific overrides
  const u = (units ?? "").trim();
  if (u === "%") {
    return `${value.toFixed(1)}%`;
  }
  if (u === "0/1") {
    return `${Math.round(value)}${displayUnit}`;
  }

  // Magnitude-based decimals
  let decimals: number;
  if (abs >= 1000) {
    decimals = 0;
  } else if (abs >= 100) {
    decimals = 1;
  } else if (abs >= 10) {
    decimals = 2;
  } else if (abs >= 1) {
    decimals = 2;
  } else if (abs >= 0.1) {
    decimals = 3;
  } else if (abs >= 0.01) {
    decimals = 4;
  } else {
    return `${value.toPrecision(4)}${displayUnit}`;
  }

  const formatted = value.toFixed(decimals);
  return `${formatted}${displayUnit}`;
}
