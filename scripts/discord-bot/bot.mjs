// DigiWiki Discord Bot
// =====================
// Listens to a specific Discord channel for patch-note messages,
// parses an emoji-prefixed template, writes a Markdown file to
// src/content/patchnote/, then triggers a Vercel rebuild via a
// Deploy Hook URL.
//
// MESSAGE TEMPLATE (paste this into Discord):
//
//   📌 [3.5.2] — Bug fixes & balance pass
//   🏷️ Major
//   📅 20 August 2026
//   ─────────────────
//   Added Omnimon Zwart Defeat.
//   Rebalanced SK digimon damage by -8%.
//   Fixed party invite bug.
//
// Lines starting with the recognised emoji tags become frontmatter fields.
// Everything after the divider becomes the Markdown body.
//
// REQUIRED ENV VARS (set in Railway/Render/etc.):
//   DISCORD_TOKEN       - bot token from Discord Developer Portal
//   CHANNEL_ID          - numeric ID of the channel to watch
//   ALLOWED_ROLE_ID     - role required to use the bot (others are ignored)
//   VERCEL_DEPLOY_HOOK  - URL from Vercel Settings → Git → Deploy Hooks

import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  EmbedBuilder,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;
const DEPLOY_HOOK = process.env.VERCEL_DEPLOY_HOOK;

// ── Safety: fail fast with a clear message if env vars are missing ─────
function requireEnv(name, value) {
  if (!value || value.trim() === '') {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
}
requireEnv('DISCORD_TOKEN', TOKEN);
requireEnv('CHANNEL_ID', CHANNEL_ID);
requireEnv('ALLOWED_ROLE_ID', ALLOWED_ROLE_ID);
requireEnv('VERCEL_DEPLOY_HOOK', DEPLOY_HOOK);

// ── Markdown file destination ──────────────────────────────────────────
// In Railway we mount the same GitHub repo via a separate clone, so the
// path below is relative to that working directory. Override with env if
// your layout differs.
const CONTENT_DIR = process.env.PATCHNOTE_DIR || 'src/content/patchnote';

// ── Template parsing ───────────────────────────────────────────────────
// Recognised emoji tags → frontmatter keys
const FIELD_MAP = {
  '📌': 'title',      // expected to contain "[version] — title"
  '🏷️': 'type',
  '📅': 'date',
};

// Date parser: accepts "20 August 2026" or ISO "2026-08-20"
function parseDate(raw) {
  const trimmed = raw.trim();
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

// Pull [version] out of the 📌 line, leave the rest as the title
function parseTitleLine(raw) {
  const m = raw.match(/\[([^\]]+)\]\s*[—\-:]\s*(.+)$/);
  if (m) return { version: m[1].trim(), title: m[2].trim() };
  return { version: '', title: raw.trim() };
}

function parseTemplate(content) {
  const fields = {};
  let bodyLines = [];
  let pastDivider = false;

  for (const line of content.split(/\r?\n/)) {
    if (line.includes('─────') || line.includes('-----')) {
      pastDivider = true;
      continue;
    }
    if (!pastDivider) {
      const emoji = Object.keys(FIELD_MAP).find((e) => line.startsWith(e));
      if (emoji) {
        const key = FIELD_MAP[emoji];
        const value = line.slice(emoji.length).trim();
        fields[key] = value;
      }
    } else {
      bodyLines.push(line);
    }
  }

  if (!fields.title) {
    throw new Error(
      'Could not find a 📌 line. Make sure the template is correct.'
    );
  }

  const { version, title } = parseTitleLine(fields.title);
  if (!version) {
    throw new Error('Could not extract [version] from the 📌 line.');
  }

  const type =
    fields.type && /major/i.test(fields.type) ? 'Major' : 'Hotfix';
  const date = parseDate(fields.date || '');
  const body = bodyLines.join('\n').trim() || '_No details provided._';

  return { version, title, type, date, body };
}

// ── Markdown writer ────────────────────────────────────────────────────
function escapeYaml(s) {
  return String(s).replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function slugifyVersion(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function writeMarkdown({ version, title, type, date, body }) {
  const slug = slugifyVersion(version);
  const filename = path.join(CONTENT_DIR, `${slug}.md`);

  const frontmatter = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `version: "${escapeYaml(version)}"`,
    `date: ${date}`,
    `type: "${type}"`,
    `description: "${escapeYaml(body.split('\n')[0].slice(0, 140))}"`,
    'tags: []',
    `order: ${Date.now()}`,
    '---',
    '',
  ].join('\n');

  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  fs.writeFileSync(filename, frontmatter + body + '\n', 'utf8');
  return filename;
}

// ── Vercel deploy hook ─────────────────────────────────────────────────
async function triggerRebuild(version) {
  try {
    const res = await fetch(DEPLOY_HOOK, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`🚀 Vercel rebuild triggered for ${version}`);
  } catch (err) {
    console.error('⚠️  Failed to trigger Vercel rebuild:', err.message);
  }
}

// ── Bot setup ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📡 Watching channel ${CHANNEL_ID}`);
});

client.on(Events.MessageCreate, async (msg) => {
  // Ignore bots, DMs, and other channels
  if (msg.author.bot) return;
  if (msg.channel.id !== CHANNEL_ID) return;

  // Permission gate: must have the editor role
  const hasRole = msg.member?.roles?.cache?.has(ALLOWED_ROLE_ID);
  if (!hasRole) {
    return msg.reply('🚫 You need the **Wiki Editor** role to publish patches.');
  }

  // Quick pre-check: must start with the 📌 template emoji
  if (!msg.content.startsWith('📌')) return;

  try {
    const parsed = parseTemplate(msg.content);
    const filepath = writeMarkdown(parsed);

    await msg.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x29f19c)
          .setTitle(`✅ Patch ${parsed.version} published`)
          .addFields(
            { name: 'Title', value: parsed.title, inline: false },
            { name: 'Type', value: parsed.type, inline: true },
            { name: 'Date', value: parsed.date, inline: true },
            { name: 'File', value: `\`${filepath}\``, inline: false }
          )
          .setTimestamp(),
      ],
    });

    await triggerRebuild(parsed.version);
  } catch (err) {
    await msg.reply(`❌ Could not publish patch: ${err.message}`);
  }
});

client.login(TOKEN);
