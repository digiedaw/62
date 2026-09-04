import fs from 'node:fs';
import path from 'node:path';

/**
 * Homepage Icon Resolver
 * 
 * Maps digimon/accessory names to their icon images in /public/.
 * 
 * Supported formats:
 * - "Dukemon_Shin"       → finds Dukemon_Shin.png (case-insensitive, _ ↔ -)
 * - "Dukemon Shin"       → same as above  
 * - "digimon/Dukemon.png"→ explicit path (pass-through)
 * - "lucide:swords"      → library name (pass-through for EntryIcon)
 * - omitted/empty        → returns undefined → EntryIcon shows emoji
 */
const IMAGE_EXT_RE = /\.(svg|png|jpe?g|webp|avif|gif)$/i;
const IMAGE_EXTS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];

const publicFolders = {
  digimon: path.join('public', 'digimon'),
  accessories: path.join('public', 'accessories'),
};

/** Scan a folder and build a map of normalized name → actual filename */
function buildFolderIndex(folder: string): Map<string, string> {
  const idx = new Map<string, string>();
  if (!fs.existsSync(folder)) return idx;
  for (const file of fs.readdirSync(folder)) {
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) {
      const base = path.basename(file, ext);
      // Normalize: lowercase, replace _ with -
      const key = base.toLowerCase().replace(/_/g, '-');
      // If duplicate keys, keep the first one
      if (!idx.has(key)) idx.set(key, file);
    }
  }
  return idx;
}

// Build indices on module load
const folderIndices = {
  digimon: buildFolderIndex(publicFolders.digimon),
  accessories: buildFolderIndex(publicFolders.accessories),
};

/**
 * Resolve an icon name to a path under /public/.
 * 
 * @param name - The icon name (e.g. "Dukemon_Shin", "jetmervamon")
 * @param folder - The folder to search in ("digimon" or "accessories")
 * @returns Path like "/digimon/Alphamon-Ouryuken-X.png" or undefined
 */
export function resolveHomepageIcon(name: string | undefined, folder: 'digimon' | 'accessories'): string | undefined {
  if (!name) return undefined;

  // If it looks like a path (contains / or extension), return as-is
  if (name.includes('/') || IMAGE_EXT_RE.test(name)) return name;

  // Normalize: lowercase, replace _ with -
  const normalized = name.toLowerCase().replace(/_/g, '-');

  // Check the appropriate folder index
  const idx = folderIndices[folder];
  if (!idx) return undefined;

  const match = idx.get(normalized);
  if (match) {
    // Return path relative to root: /digimon/filename.png
    return `/${folder}/${match}`;
  }

  // Also try: just the slug part (without extension) - some entries 
  // have the slug as the icon name
  const slugParts = name.toLowerCase().split(/\s+/)[0];
  const slugMatch = idx.get(slugParts);
  if (slugMatch) return `/${folder}/${slugMatch}`;

  return undefined;
}