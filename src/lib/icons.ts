import fs from 'node:fs';
import path from 'node:path';

/**
 * ICON RESOLVER — name-based icon lookup, indexed from /public at build time.
 *
 * Instead of hardcoding full paths in frontmatter:
 *
 *   icon: "Dukemon_Shin"        ← bare NAME: matched against public/<collection>/
 *                                  (case-insensitive, "_" ≡ "-")
 *   (no icon field at all)      ← auto-tries the entry's SLUG as the name
 *                                  (slug "dukemon-shin" finds Dukemon_Shin.png)
 *   icon: "digimon/Foo.png"     ← explicit path still works (used as-is)
 *   icon: "lucide:swords"       ← icon-library name still works (EntryIcon slot)
 *
 * If nothing matches, undefined is returned → EntryIcon falls back to the emoji.
 * The folder index is scanned ONCE per collection per build (cached in-module).
 */

const IMAGE_EXT_RE = /\.(svg|png|jpe?g|webp|avif|gif)$/i;
const IMAGE_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];

/** Forgiving lookup key: lowercase, underscores treated as hyphens */
const normalize = (s: string): string => s.toLowerCase().replace(/_/g, '-');

/** collection name → Map<normalizedName, actualFileName> */
const folderIndex = new Map<string, Map<string, string>>();

function indexCollection(collection: string): Map<string, string> {
  const cached = folderIndex.get(collection);
  if (cached) return cached;

  const idx = new Map<string, string>();
  const dir = path.join('public', collection);
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXTS.includes(ext)) {
        idx.set(normalize(path.basename(file, path.extname(file))), file);
      }
    }
  }
  folderIndex.set(collection, idx);
  return idx;
}

export interface IconRef {
  /** Collection folder under /public to search (e.g. "digimon") */
  collection: string;
  /** Entry id/slug, used for the automatic slug-based lookup */
  slug: string;
  /** Raw frontmatter `icon` value (name, path or library name) */
  icon?: string;
}

/**
 * Returns a servable path ("/digimon/Dukemon_Shin.png"), a library name,
 * or undefined (→ EntryIcon shows the emoji fallback).
 */
export function resolveIcon({ collection, slug, icon }: IconRef): string | undefined {
  if (icon) {
    // Explicit path, extension or library namespace → pass through untouched
    if (icon.includes('/') || icon.includes(':') || IMAGE_EXT_RE.test(icon)) {
      return icon;
    }
    // Bare name → forgiving match inside public/<collection>/
    const hit = indexCollection(collection).get(normalize(icon));
    return hit ? `/${collection}/${hit}` : undefined;
  }
  // No icon field → try the slug as the name
  const hit = indexCollection(collection).get(normalize(slug));
  return hit ? `/${collection}/${hit}` : undefined;
}