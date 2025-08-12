import { type CSSProperties, useEffect, useState } from 'react';

const NAME_TO_STEM: Record<string, string> = {
  plus: 'plus',
  import: 'square.and.arrow.down',
  export: 'square.and.arrow.up',
  gear: 'gear',
  warn: 'exclamationmark.triangle.fill',
};

export function Icon({
  name,
  src,
  size = 14,
  color = 'currentColor',
  className,
  ariaLabel,
  title,
}: {
  name?: keyof typeof NAME_TO_STEM | string;
  src?: string;
  size?: number;
  color?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const base = (import.meta as any).env?.BASE_URL || '/';
  const [selectedUrl, setSelectedUrl] = useState('');
  const [ratio, setRatio] = useState<number | null>(null);

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

  // Measure to preserve aspect ratio
  useEffect(() => {
    if (!selectedUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setRatio(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = selectedUrl;
  }, [selectedUrl]);

  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: ratio ? Math.round(size / ratio) : size,
    backgroundColor: color,
  WebkitMaskImage: `url(${selectedUrl})`,
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
  maskImage: `url(${selectedUrl})`,
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain',
    verticalAlign: 'middle',
  } as CSSProperties;

  const ariaProps = ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true } as any;

  return <span className={className} style={style} {...ariaProps} title={title} />;
}
