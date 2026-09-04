// Quick test harness for parseFullDocument — uses the actual patch3.5.0.md
// from your repo. Run with:  node scripts/discord-bot/test-parser.mjs
import fs from 'node:fs';
import path from 'node:path';

// We can't import from bot.mjs because of the side-effects (it would
// try to log in). Re-declare just the parser inline.
const FIELD_MAP = { '📌': 'title', '🏷️': 'type', '📅': 'date' };

function parseDate(raw) {
  const trimmed = raw.trim();
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function unwrapCodeBlock(raw) {
  const fenced = raw.match(/```(?:md|markdown)?\n([\s\S]*?)\n```/);
  return fenced ? fenced[1] : raw;
}

function parseFullDocument(raw) {
  const text = unwrapCodeBlock(raw);
  const lines = text.split(/\r?\n/);

  const fm = {
    title: '',
    version: '',
    date: new Date().toISOString().slice(0, 10),
    type: 'Hotfix',
    description: '',
    emoji: '🛠️',
    tags: [],
    order: Date.now(),
  };

  let body = text;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      const yaml = lines.slice(1, end).join('\n');
      for (const ln of yaml.split(/\r?\n/)) {
        const m = ln.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
        if (!m) continue;
        const [, key, valueRaw] = m;
        const value = valueRaw.replace(/^["']|["']$/g, '');
        if (key === 'tags') {
          const arrMatch = value.match(/^\[(.*)\]$/);
          if (arrMatch && arrMatch[1].trim() === '') fm.tags = [];
          else if (arrMatch)
            fm.tags = arrMatch[1]
              .split(',')
              .map((t) => t.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
          else
            fm.tags = value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
        } else if (key in fm) fm[key] = value;
      }
      body = lines.slice(end + 1).join('\n').trim();
    }
  }

  if (!fm.version) {
    const heading = body.match(/^#\s*(?:Patch\s+)?v?(\d+\.\d+(?:\.\d+)?)/im);
    if (heading) fm.version = heading[1];
  }
  if (!fm.title && fm.version) fm.title = `Patch ${fm.version}`;
  if (!fm.title) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) fm.title = h1[1].trim();
  }

  if (fm.date === new Date().toISOString().slice(0, 10)) {
    const releaseMatch = body.match(
      />\s*\*\*Release Date:\*\*\s*([^*\n]+)/i
    );
    if (releaseMatch) fm.date = parseDate(releaseMatch[1]);
  }

  if (!/major|hotfix/i.test(fm.type)) {
    if (/balance\s*changes|new\s*dungeon|new\s*digimon/i.test(body)) {
      fm.type = 'Major';
    } else {
      fm.type = 'Hotfix';
    }
  }

  if (!fm.description) {
    const para = body
      .split(/\r?\n\r?\n/)
      .find((p) => p.trim() && !p.startsWith('#') && !p.startsWith('>'));
    if (para) {
      fm.description = para
        .replace(/[#*`_>]/g, '')
        .replace(/\n/g, ' ')
        .trim()
        .slice(0, 200);
    }
  }

  return {
    version: fm.version,
    title: fm.title || `Patch ${fm.version}`,
    type: fm.type === 'Major' ? 'Major' : 'Hotfix',
    date: fm.date,
    emoji: fm.emoji || '🛠️',
    description: fm.description,
    tags: Array.isArray(fm.tags)
      ? fm.tags
      : String(fm.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
    body,
  };
}

// ─── Test against the real patch3.5.0.md ─────────────────────────────
const repoRoot = path.resolve('..', '..');
const sample = fs.readFileSync(
  path.join(repoRoot, 'src', 'content', 'patchnote', 'patch3.5.0.md'),
  'utf8'
);

const result = parseFullDocument(sample);
console.log('PARSED RESULT:');
console.log(JSON.stringify(
  {
    version: result.version,
    title: result.title,
    type: result.type,
    date: result.date,
    emoji: result.emoji,
    description: result.description,
    tags: result.tags,
    bodyChars: result.body.length,
    bodyStart: result.body.slice(0, 200),
  },
  null,
  2
));

// Sanity assertions
const expected = {
  version: '3.5.0',
  title: 'Patch 3.5.0',
  type: 'Major',
  date: '2026-08-06',
  emoji: '🛠️',
};
for (const [k, v] of Object.entries(expected)) {
  if (result[k] !== v) {
    console.error(`❌ Mismatch on ${k}: expected ${v}, got ${result[k]}`);
    process.exit(1);
  }
}
console.log('\n✅ All expected fields match');

// ─── Test 2: Discord code-block wrapper ──────────────────────────────
const wrapped = '```md\n' + sample + '\n```';
const result2 = parseFullDocument(wrapped);
console.log('\nTEST 2 (code-block wrapped):');
console.log('  version:', result2.version);
console.log('  title:  ', result2.title);
console.log('  type:   ', result2.type);
console.log('  date:   ', result2.date);
if (result2.version !== '3.5.0') {
  console.error('❌ Code-block wrap failed');
  process.exit(1);
}
console.log('✅ Code-block unwrap works');
