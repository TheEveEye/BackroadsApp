import type { CSSProperties } from 'react';
import type { AnsiblexRouteZones } from '../lib/ansiblex';
import { ANSIBLEX_ZONE_COLORS, ANSIBLEX_ZONES } from '../lib/ansiblexZones';
import { Icon } from './Icon';

const stops = [0, ...ANSIBLEX_ZONES];
const colors = ['#64748b', ...ANSIBLEX_ZONES.map((zone) => ANSIBLEX_ZONE_COLORS[zone])];
const gradient = `linear-gradient(to right, ${colors.map((color, index) => `${color} ${index * 20}%`).join(', ')})`;

export function AnsiblexZoneSlider({ value, onChange, onConfigure }: {
  value: number;
  onChange: (zone: number) => void;
  onConfigure: () => void;
}) {
  const color = colors[value];
  return <div className="w-full py-1"
    style={{ '--ansi-color': color } as CSSProperties}>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="ansiblex-zone-slider" className="mr-auto inline-flex items-center gap-2 font-medium">
        <Icon name="link" size={15} className="text-slate-500 dark:text-slate-400" />Ansiblexes
      </label>
      <output htmlFor="ansiblex-zone-slider" className="inline-flex min-w-20 items-center justify-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
        style={{ borderColor: `${color}40`, backgroundColor: `${color}12` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        {value === 0 ? 'Disabled' : `Zone ${value}`}
      </output>
      <button type="button" onClick={onConfigure} aria-label="Configure Ansiblexes"
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
        <Icon name="gear" size={14} />Configure…
      </button>
    </div>
    <div className="relative mt-2">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-2.5 top-3.5 h-1.5 rounded-full">
        <div className="absolute inset-0 rounded-full opacity-20" style={{ background: gradient }} />
        <div className="absolute inset-0 rounded-full" style={{ background: gradient, clipPath: `inset(0 ${100 - value * 20}% 0 0)` }} />
        {stops.map((stop) => <span key={stop} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${stop * 20}%`, backgroundColor: colors[stop], opacity: stop <= value ? 1 : 0.3 }} />)}
      </div>
      <input id="ansiblex-zone-slider" type="range" min={0} max={5} step={1} value={value}
        aria-valuetext={value === 0 ? 'Ansiblexes disabled' : `Zones 1 through ${value} allowed`}
        className="ansiblex-zone-slider relative block h-8 w-full cursor-pointer appearance-none bg-transparent"
        onChange={(event) => onChange(Number(event.target.value))} />
      <div aria-hidden="true" className="relative mx-2.5 h-4 text-[11px] leading-4">
        {stops.map((stop) => <span key={stop} className={`absolute -translate-x-1/2 ${stop === value ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
          style={{ left: `${stop * 20}%` }}>{stop === 0 ? 'Off' : stop}</span>)}
      </div>
    </div>
  </div>;
}

export function AnsiblexZoneBadges({ summary }: { summary: AnsiblexRouteZones | undefined }) {
  if (!summary?.count) return null;
  return <span className="mb-1 flex flex-wrap gap-1">
    {summary.zones.map((zone) => <span key={zone} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">Ansiblex Zone {zone}</span>)}
    {summary.unknownZone && <span className="rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 px-1.5 py-0.5">Zone unknown</span>}
  </span>;
}
