import fs from 'node:fs';

/**
 * SINGLE SOURCE OF TRUTH for site navigation.
 *
 * - New ITEMS        -> zero edits: drop a .md in any collection folder.
 * - New GROUP VALUE  -> appears automatically; optionally add it to
 *                       groupOrder below for display position.
 * - New CATEGORY     -> just create src/content/<name>/ - it becomes a
 *   FOLDER              collection (see content.config.ts), gets sidebar
 *                       section + pages automatically. Zero edits here.
 * - Curated sections -> tune labels/order in SIDEBAR_SECTIONS below.
 */

/** Folders with hand-tuned schemas/pages in content.config.ts */
export const CURATED_COLLECTIONS = ['digimon', 'accessories'] as const;

import { resolveIcon } from './icons';

/** Every OTHER top-level folder under src/content becomes an auto collection */
export function getAutoCollectionNames(): string[] {
  const root = './src/content';
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith('_') &&
        !(CURATED_COLLECTIONS as readonly string[]).includes(d.name)
    )
    .map((d) => d.name);
}

/** Curated + auto-discovered - every collection on the site */
export function getAllCollectionNames(): string[] {
  return [...CURATED_COLLECTIONS, ...getAutoCollectionNames()];
}

/** Find the registered section for a collection name (curated or auto). */
export function getSectionByCollection(
  name: string
): SidebarSection | undefined {
  return [...SIDEBAR_SECTIONS, ...getAutoSections()].find(
    (s) => s.collection === name
  );
}

const titleCase = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

export interface SidebarSection {
  /** Heading shown in the sidebar */
  label: string;
  /** Section landing page ("view all" link) */
  href: string;
  /** Content-collection name defined in src/content.config.ts */
  collection: string;
  /** Frontmatter field that groups items (e.g. 'stage', 'category') */
  groupField?: string;
  /** Preferred group display order - unknown values appended alphabetically */
  groupOrder?: readonly string[];
  /** Group label used when the field is empty/missing */
  fallbackGroup?: string;
  /** Hub card icon (emoji, or an image path under /public) */
  emoji?: string;
  /** Hub card tag badge, e.g. DIGI / GEAR / DATA */
  tag?: string;
  /** Hub card one-line description */
  blurb?: string;
}

/** Hand-curated sections (rich schemas + custom landing pages exist) */
export const SIDEBAR_SECTIONS: readonly SidebarSection[] = [
  {
    label: 'Digimon',
    emoji: '🐾',
    tag: 'DIGI',
    blurb: 'Every Digimon entry — evolution lines, stats, ranks and lore.',
    href: '/digimon/',
    collection: 'digimon',
    groupField: 'rank',
    groupOrder: ['SSS+', 'SSS', 'U'],
    fallbackGroup: 'Unclassified',
  },
  {
    label: 'Gear & Guides',
    emoji: '🎒',
    tag: 'GEAR',
    blurb: 'Goggles, digivices, equipment, clothing and guides.',
    href: '/accessories/',
    collection: 'accessories',
    groupField: 'category',
    groupOrder: ['Goggles', 'Digivice', 'Equipment', 'Cloth', 'Guide'],
    fallbackGroup: 'Other',
  },
];

/** Hub-card metadata overrides for auto-discovered folders (by folder name). */
export const HUB_META: Record<string, Partial<SidebarSection>> = {
  dungeon: { emoji: '🗺️', tag: 'DATA', blurb: 'Dungeon maps, spawn areas and boss strategies.' },
  items: { emoji: '📦', tag: 'DATA', blurb: 'Consumables, materials, drop tables and crafting.' },
  guide: { emoji: '📖', tag: 'DATA', blurb: 'Community guides, tips and how-to walkthroughs.' },
  system: { emoji: '⚙️', tag: 'DATA', blurb: 'Game systems, mechanics, rules and patch notes.' },
  playstyle: { emoji: '⚔️', tag: 'PLAY', blurb: 'Skill DPS, Auto Attack and Tank build guides.' },
  progression: { emoji: '📈', tag: 'ROAD', blurb: 'New player journey — pre-early to mid-game progression.' },
};

/** Sections generated from auto-discovered folders (src/content/<name>/). */
export function getAutoSections(): SidebarSection[] {
  return getAutoCollectionNames().map((name) => ({
    label: titleCase(name),
    href: `/${name}/`,
    collection: name,
    groupField: 'category',
    fallbackGroup: 'All',
    ...(HUB_META[name] ?? {}),
  }));
}

export interface NavItem {
  description?: string;
  title: string;
  emoji: string;
  icon?: string;
  href: string;
}

export interface NavGroup {
  label: string;
  count: number;
  items: NavItem[];
}

export interface NavSection {
  label: string;
  href: string;
  total: number;
  groups: NavGroup[];
}

/** Structural entry shape - works for curated AND auto collections */
interface NavEntry {
  id: string;
  data: {
    title: string;
    emoji?: string;
    icon?: string;
    description?: string;
    order?: number;
  };
}

/** Turns a flat list of entries into grouped, ordered sidebar data. */
export function buildNavSection(
  section: SidebarSection,
  entries: readonly NavEntry[]
): NavSection {
  // Sort once: numeric order first, then alphabetical by title
  const sorted = [...entries].sort(
    (a, b) =>
      (a.data.order ?? 99) - (b.data.order ?? 99) ||
      a.data.title.localeCompare(b.data.title)
  );

  const byGroup = new Map<string, NavItem[]>();
  for (const entry of sorted) {
    const raw = section.groupField
      ? (entry.data as Record<string, unknown>)[section.groupField]
      : undefined;
    const label =
      typeof raw === 'string' && raw.length > 0
        ? raw
        : section.fallbackGroup ?? 'All';

    const bucket = byGroup.get(label);
    const item: NavItem = {
      title: entry.data.title,
      emoji: entry.data.emoji ?? '\u{1F4C4}',
      icon: resolveIcon({
        collection: section.collection,
        slug: entry.id,
        icon: entry.data.icon,
      }),
      description:
        (entry.data as Record<string, unknown>).description as string ?? '',
      href: `${section.href}${entry.id}/`,
    };
    if (bucket) bucket.push(item);
    else byGroup.set(label, [item]);
  }

  // Preferred order first, unknown groups after (alphabetically)
  const rank = (label: string): number => {
    const i = section.groupOrder?.indexOf(label) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  const groups: NavGroup[] = [...byGroup.entries()]
    .map(([label, items]) => ({ label, count: items.length, items }))
    .sort(
      (a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label)
    );

  return {
    label: section.label,
    href: section.href,
    total: entries.length,
    groups,
  };
}
