export const NULLSEC_SECURITY_COLOR = '#833862';

const SECURITY_COLORS = [
  NULLSEC_SECURITY_COLOR,
  '#692623',
  '#AC2822',
  '#BD4E26',
  '#CC722C',
  '#F5FD93',
  '#90E56A',
  '#82D8A8',
  '#73CBF3',
  '#5698E5',
  '#4173DB',
];

export function getSovereigntySecurityColor(value: number) {
  const securityIndex = value <= 0
    ? 0
    : Math.min(10, Math.ceil(value * 10));
  return SECURITY_COLORS[securityIndex] ?? SECURITY_COLORS[0];
}
