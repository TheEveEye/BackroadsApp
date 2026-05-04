export const mapFontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

const securityColors = ['#833862','#692623','#AC2822','#BD4E26','#CC722C','#F5FD93','#90E56A','#82D8A8','#73CBF3','#5698E5','#4173DB'];

export function getIsDarkMode() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const bg = window.getComputedStyle(document.body).backgroundColor || '';
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
    if (match) {
      const r = Number(match[1]) / 255;
      const g = Number(match[2]) / 255;
      const b = Number(match[3]) / 255;
      const a = match[4] != null ? Number(match[4]) : 1;
      if (a > 0) {
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance < 0.45;
      }
    }
  } catch {
    // Fall back to the media query below if computed styles are unavailable.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function securityColor(value: number) {
  const index = value <= 0 ? 0 : Math.min(10, Math.ceil(value * 10));
  return securityColors[index] || securityColors[0];
}

function arcControlPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  ampScale = 0.22,
  minAmp = 28,
  maxAmp = 140,
) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (Math.abs(ny) < 1e-6) {
    nx = 0;
    ny = -1;
  } else if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const amp = Math.min(maxAmp, Math.max(minAmp, len * ampScale));
  return { x: mx + nx * amp, y: my + ny * amp };
}

export function drawQuadraticArc(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  ampScale: number,
  minAmp: number,
  maxAmp: number,
  drawArrow = false,
) {
  const ctrl = arcControlPoint(from, to, ampScale, minAmp, maxAmp);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y);
  ctx.stroke();

  if (!drawArrow) return;
  const angle = Math.atan2(to.y - ctrl.y, to.x - ctrl.x);
  const size = 8;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#9333ea';
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
