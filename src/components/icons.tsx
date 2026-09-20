import { For, type JSX } from 'solid-js';

/** Three marks, drawn at 14px in `currentColor`: what a rail needs, and no icon dependency for it. */
const BASE: JSX.SvgSVGAttributes<SVGSVGElement> = {
  width: '14',
  height: '14',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
};

export function SearchIcon() {
  return (
    <svg {...BASE}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...BASE}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg {...BASE}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** The marks a project can be given: drawn at any size by the tile that holds them, in the colour it is tinted. */
const MARK: JSX.SvgSVGAttributes<SVGSVGElement> = {
  width: '100%',
  height: '100%',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.8',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
};

const mark = (...paths: string[]) => () => (
  <svg {...MARK}>
    <For each={paths}>{(d) => <path d={d} />}</For>
  </svg>
);

export const ICONS: { id: string; label: string; Icon: () => JSX.Element }[] = [
  { id: 'box', label: 'Box', Icon: mark('M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z', 'M3 8.5 12 13l9-4.5M12 13v7') },
  { id: 'book', label: 'Book', Icon: mark('M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z', 'M8 4v16') },
  { id: 'layers', label: 'Layers', Icon: mark('m12 4 8 4-8 4-8-4z', 'm4 12 8 4 8-4', 'm4 16 8 4 8-4') },
  {
    id: 'gear',
    label: 'Settings',
    Icon: mark(
      'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
      'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    ),
  },
  {
    id: 'rocket',
    label: 'Rocket',
    Icon: mark('M5 19c0-3 1-4 3-6l7-7c1-1 3-1 4-2 0 2 0 4-1 5l-7 7c-2 2-3 3-6 3z', 'M9 13l2 2M14 9l1 1'),
  },
  { id: 'terminal', label: 'Terminal', Icon: mark('M4 5h16v14H4z', 'm8 10 2 2-2 2M13 14h4') },
  { id: 'chart', label: 'Chart', Icon: mark('M4 20V4', 'M8 20v-6M13 20V9M18 20v-9') },
  { id: 'cloud', label: 'Cloud', Icon: mark('M7 18h9a4 4 0 0 0 .6-8A5 5 0 0 0 7 9a4.5 4.5 0 0 0 0 9z') },
  {
    id: 'database',
    label: 'Database',
    Icon: mark(
      'M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z',
      'M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7',
      'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
    ),
  },
  { id: 'code', label: 'Code', Icon: mark('m9 9-4 3 4 3M15 9l4 3-4 3') },
];

export const ICON_BY_ID: Record<string, () => JSX.Element> = Object.fromEntries(
  ICONS.map((entry) => [entry.id, entry.Icon]),
);