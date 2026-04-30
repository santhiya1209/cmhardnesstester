export function formatMicrometerValue(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(3)} mm`;
}
