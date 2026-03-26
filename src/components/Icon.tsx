import { type CSSProperties, useEffect, useState } from 'react';

const NAME_TO_STEM: Record<string, string> = {
  plus: 'plus',
  import: 'square.and.arrow.down',
  export: 'square.and.arrow.up',
  gear: 'gear',
  warn: 'exclamationmark.triangle.fill',
  discord: 'discord',
  link: 'link',
  copy: 'square.on.square',
  close: 'xmark',
  'chevron-down': 'chevron.down',
};

const SHIP_TO_FILENAME: Record<string, string> = {
  'Black Ops': 'battleship_32.png',
  'Carrier Jump': 'carrier_32.png',
  'Carrier Conduit': 'carrier_32.png',
  'Dreadnought': 'dreadnought_32.png',
  'Force Auxiliary': 'forceAuxiliary_32.png',
  'Jump Freighter': 'freighter_32.png',
  'Lancer Dreadnought': 'dreadnought_32.png',
  'Rorqual': 'freighter_32.png',
  'Supercarrier Jump': 'superCarrier_32.png',
  'Titan': 'titan_32.png',
  'Titan Bridge': 'titan_32.png',
  'Titan Jump': 'titan_32.png',
};

function getIsDarkMode() {
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
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function Icon({
  name,
  ship,
  src,
  size = 14,
  color = 'currentColor',
  className,
  ariaLabel,
  title,
  // optional vertical nudge in pixels for optical centering
  offsetY,
}: {
  name?: keyof typeof NAME_TO_STEM | string;
  ship?: keyof typeof SHIP_TO_FILENAME | string;
  src?: string;
  size?: number;
  color?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  offsetY?: number;
}) {
  const base = (import.meta as any).env?.BASE_URL || '/';
  const [selectedUrl, setSelectedUrl] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  // Keep icons square for reliable centering in flex containers

  // Resolve URL: prefer provided src, then ship art, then regular UI icon assets.
  useEffect(() => {
    if (src) { setSelectedUrl(src); return; }
    if (ship) {
      const file = SHIP_TO_FILENAME[String(ship)];
      setSelectedUrl(file ? `${base}eve/${file}` : '');
      return;
    }
    const key = name ? String(name) : '';
    const stem = NAME_TO_STEM[key];
    if (!stem) { setSelectedUrl(''); return; }
    const trySvg = base + 'icons/' + stem + '.svg';
    const tryPng = base + 'icons/' + stem + '.png';
    const probe = new Image();
    probe.onload = () => setSelectedUrl(trySvg);
    probe.onerror = () => setSelectedUrl(tryPng);
    probe.src = trySvg;
  }, [src, ship, name, base]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDarkMode(getIsDarkMode());
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  // No aspect-ratio adjustments: use a square box so it's centered next to text

  // optical adjustments for some glyphs
  const OFFSET_BY_NAME: Record<string, number> = {
    export: 0.5,
    import: 0.5,
  };
  const yNudge = typeof offsetY === 'number' ? offsetY : (name ? OFFSET_BY_NAME[String(name)] ?? 0 : 0);

  const sharedStyle: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    verticalAlign: 'middle',
    flexShrink: 0,
    transform: yNudge ? `translateY(${yNudge}px)` : undefined,
  };

  if (ship) {
    return (
      <img
        className={className}
        src={selectedUrl}
        alt={ariaLabel ?? ''}
        aria-hidden={ariaLabel ? undefined : true}
        title={title}
        style={{ ...sharedStyle, objectFit: 'contain', filter: isDarkMode ? undefined : 'invert(1)' }}
      />
    );
  }

  const style: CSSProperties = {
    ...sharedStyle,
    backgroundColor: color,
    WebkitMaskImage: `url(${selectedUrl})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: '100% 100%',
    maskImage: `url(${selectedUrl})`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: '100% 100%',
  };

  const ariaProps = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true } as any;

  return <span className={className} style={style} {...ariaProps} title={title} />;
}
