import { type CSSProperties, useEffect, useState } from 'react';

const NAME_TO_STEM: Record<string, string> = {
  plus: 'plus',
  import: 'square.and.arrow.down',
  export: 'square.and.arrow.up',
  gear: 'gear',
  warn: 'exclamationmark.triangle.fill',
  discord: 'discord',
  link: 'link',
};

export function Icon({
  name,
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
  // Keep icons square for reliable centering in flex containers

  // Resolve URL: prefer provided src; otherwise try SVG then PNG for known name
  useEffect(() => {
    if (src) { setSelectedUrl(src); return; }
    const key = name ? String(name) : '';
    const stem = NAME_TO_STEM[key];
    if (!stem) { setSelectedUrl(''); return; }
    const trySvg = base + stem + '.svg';
    const tryPng = base + stem + '.png';
    const probe = new Image();
    probe.onload = () => setSelectedUrl(trySvg);
    probe.onerror = () => setSelectedUrl(tryPng);
    probe.src = trySvg;
  }, [src, name, base]);

  // No aspect-ratio adjustments: use a square box so it's centered next to text

  // optical adjustments for some glyphs
  const OFFSET_BY_NAME: Record<string, number> = {
    export: 0.5,
    import: 0.5,
  };
  const yNudge = typeof offsetY === 'number' ? offsetY : (name ? OFFSET_BY_NAME[String(name)] ?? 0 : 0);

  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    backgroundColor: color,
    WebkitMaskImage: `url(${selectedUrl})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
  WebkitMaskSize: '100% 100%',
    maskImage: `url(${selectedUrl})`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  maskSize: '100% 100%',
    verticalAlign: 'middle',
    flexShrink: 0,
    transform: yNudge ? `translateY(${yNudge}px)` : undefined,
  } as CSSProperties;

  const ariaProps = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true } as any;

  return <span className={className} style={style} {...ariaProps} title={title} />;
}
