import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import fs from 'node:fs';

/**
 * Folders managed with rich, strict schemas below.
 * EVERY OTHER top-level folder inside src/content is picked up AUTOMATICALLY
 * as its own collection (see autoCollections at the bottom of this file),
 * so adding a new category folder requires ZERO code changes.
 */
const EXPLICIT_FOLDERS = ['digimon', 'accessories', 'patchnote'] as const;

/**
 * Every Markdown file in src/content/digimon becomes a wiki page.
 * The schema below validates each file's frontmatter at build time.
 */
const digimon = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/digimon' }),
  schema: z.object({
    /** Page title, e.g. "Agumon" */
    title: z.string(),
    /** Emoji used as an avatar/thumbnail across the site (fallback when no icon is set) */
    emoji: z.string().default('🥚'),
    /** Optional icon-library name, e.g. "lucide:swords" — rendered by src/components/EntryIcon.astro */
    icon: z.string().optional(),
    /** Evolution stage — used to group entries in lists */
    stage: z.enum(['Fresh', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega']).optional(),
    /** Rarity rank — powers the Rank filter */
    rank: z.enum(['SSS+', 'SSS', 'U']).optional(),
    /** Combat attribute — powers the Attribute filter */
    attribute: z.enum(['Vaccine', 'Virus', 'Data']).optional(),
    /** Combat role — powers the Type filter */
    role: z.enum(['Autoattack', 'Skill', 'Tank']).optional(),
    partner: z.string().optional(),
    /** Short summary shown on cards and search results */
    description: z.string(),
    tags: z.array(z.string()).default([]),
    /** Sorting position within its stage group */
    order: z.number().default(99),
  }),
});

/**
 * Accessories: goggles, digivices, equipment, clothing and guides.
 * Files live in src/content/accessories (nested subfolders are included too)
 */
const accessories = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/accessories' }),
  schema: z.object({
    title: z.string(),
    /** Emoji fallback shown until an icon name is set */
    emoji: z.string().default('🎒'),
    /** Optional icon-library name, e.g. "lucide:map" — rendered by src/components/EntryIcon.astro */
    icon: z.string().optional(),
    /** Powers the category filter & grouping */
    category: z.enum(['Goggles', 'Digivice', 'Equipment', 'Cloth', 'Guide']),
    /** Who wears/uses this item */
    owner: z.string().optional(),
    /** Short summary shown on cards and search results */
    description: z.string(),
    tags: z.array(z.string()).default([]),
    /** Sorting position within its category group */
    order: z.number().default(99),
  }),
});

/**
 * Patch notes: every balance change and content drop.
 * Each Markdown file in src/content/patchnote/ is one patch entry.
 * Used by /patchnote/ (archive) and /patchnote/[version]/ (per-patch pages).
 */
const patchnote = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/patchnote' }),
  schema: z.object({
    title: z.string(),
    /** Human version, e.g. "3.5.1" — used in URLs and headings */
    version: z.string(),
    /** Release date — drives sort order (newest first) and per-page date display */
    date: z.coerce.date(),
    emoji: z.string().default('📝'),
    /** "Major" = colored accent badge, "Hotfix" = muted */
    type: z.enum(['Major', 'Hotfix']).default('Hotfix'),
    /** One-line summary shown on cards */
    description: z.string(),
    tags: z.array(z.string()).default([]),
    /** Lower number = higher in the list (newer = smaller) */
    order: z.number().default(99),
  }),
});

/**
 * Generic schema shared by every AUTO-DISCOVERED collection folder.
 * Everything except title/description is optional, so plain notes work too.
 */
const genericSchema = z.object({
  title: z.string(),
  emoji: z.string().default('📄'),
  icon: z.string().optional(), // image path under /public, or icon-library name
  /** Optional grouping field — powers sidebar groups when present */
  category: z.string().optional(),
  owner: z.string().optional(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  order: z.number().default(99),
});

/**
 * AUTO-COLLECTION MAGIC ✨
 * Scan src/content and turn every top-level folder that has no explicit
 * definition above into its own content collection automatically.
 * Example: creating src/content/guide/ instantly creates the `guide`
 * collection → pages at /guide/<file>/, sidebar section, search entries.
 */
const autoFolders = fs
  .readdirSync('./src/content', { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      !d.name.startsWith('_') &&
      !(EXPLICIT_FOLDERS as readonly string[]).includes(d.name)
  )
  .map((d) => d.name);

const autoCollections = Object.fromEntries(
  autoFolders.map((name) => [
    name,
    defineCollection({
      loader: glob({ pattern: '**/*.md', base: `./src/content/${name}` }),
      schema: genericSchema,
    }),
  ])
);

export const collections = { digimon, accessories, patchnote, ...autoCollections };

