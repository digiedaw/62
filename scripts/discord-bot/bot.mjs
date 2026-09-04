// DigiWiki Discord Bot
// =====================
// Listens to a specific Discord channel for patch-note messages,
// parses an emoji-prefixed template, writes a Markdown file to
// src/content/patchnote/, COMMITS it to GitHub, then triggers a
// Vercel rebuild via a Deploy Hook URL.
//
// FLOW:
//   Discord msg  →  write .md locally  →  git add/commit/push  →  Vercel rebuild
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
//   GITHUB_TOKEN        - Personal Access Token with `repo` scope
//   GITHUB_REPO         - "owner/repo" form, e.g. "digiedaw/62"
//   GIT_USER_NAME       - commit author name (e.g. "DigiWiki Bot")
//   GIT_USER_EMAIL      - commit author email
//   VERCEL_DEPLOY_HOOK  - URL from Vercel Settings → Git → Deploy Hooks
//                         (optional — Vercel auto-rebuilds on git push anyway)

import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  EmbedBuilder,
} from 'discord.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ALLOWED_ROLE_ID = process.env.ALLOWED_ROLE_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GIT_USER_NAME = process.env.GIT_USER_NAME || 'DigiWiki Bot';
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || 'bot@digiedaw.local';
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
requireEnv('GITHUB_TOKEN', GITHUB_TOKEN);
requireEnv('GITHUB_REPO', GITHUB_REPO);
if (DEPLOY_HOOK) {
  console.log('ℹ️  VERCEL_DEPLOY_HOOK set — will trigger rebuilds manually.');
} else {
  console.log(
    'ℹ️  No VERCEL_DEPLOY_HOOK — relying on Vercel auto-rebuild on git push.'
  );
}

// ── Repo workspace ─────────────────────────────────────────────────────
// Railway only deploys the bot folder, NOT the whole wiki repo. So we
// clone the wiki repo into a workspace folder at startup. All git
// commands run inside this folder.
const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR || './wiki-repo');

async function ensureRepo() {
  if (fs.existsSync(path.join(WORKSPACE, '.git'))) {
    console.log(`📂 Wiki repo already cloned at ${WORKSPACE}`);
    return;
  }

  const authUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;
  console.log(`📥 Cloning ${GITHUB_REPO} into ${WORKSPACE}…`);
  fs.mkdirSync(WORKSPACE, { recursive: true });
  await exec('git', ['clone', '--depth', '50', authUrl, WORKSPACE], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  console.log(`✅ Repo cloned`);
}

// ── Markdown file destination ──────────────────────────────────────────
// Relative to the cloned wiki repo.
const CONTENT_DIR = path.join(WORKSPACE, process.env.PATCHNOTE_SUBDIR || 'src/content/patchnote');

// ── Template parsing ───────────────────────────────────────────────────
const FIELD_MAP = {
  '📌': 'title', // expected to contain "[version] — title"
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

// ── Forwarded-message parsing ──────────────────────────────────────────
// Detects patch content inside an auto-forwarded Discord message.
//
// Returns: { detected, confidence, parsed } where confidence is
//   'high' (definitely a patch), 'medium' (likely), 'low' (maybe).
// Returns { detected: false } if the message doesn't look like a patch.
//
// Heuristics:
//   - First line contains a version like "v3.5.2", "Patch 3.5.2", or "3.5.2"
//   - Message has patch-related keywords: patch, hotfix, balance, update,
//     buff, nerf, fix, change, notes, changelog, release
//   - Forwarded from another server (msg.messageSnapshots / cross_post)
const PATCH_KEYWORDS =
  /\b(patch|hotfix|balance|update|buff|nerf|fix|change[s]?|notes|changelog|release|version|maintenance)\b/i;

function parseForwarded(msg) {
  // Pull content out of the original forwarded snapshot if present.
  // Discord exposes this on `messageSnapshots` for cross-server forwards.
  let original = msg.content || '';
  let snapshotTitle = '';
  let snapshotDescription = '';
  let snapshotFields = [];

  if (msg.messageSnapshots && msg.messageSnapshots.size > 0) {
    const snap = msg.messageSnapshots.first();
    const embeds = snap.embeds || [];
    const e0 = embeds[0];
    if (e0) {
      snapshotTitle = e0.title || '';
      snapshotDescription = e0.description || '';
      snapshotFields = (e0.fields || []).map((f) => ({
        name: f.name,
        value: f.value,
      }));
    }
    if (snap.content) original = snap.content;
  }

  // Concatenate everything for keyword scanning
  const haystack = [
    original,
    snapshotTitle,
    snapshotDescription,
    snapshotFields.map((f) => `${f.name}: ${f.value}`).join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  // Score
  let confidence = 'low';
  const looksLikePatch = PATCH_KEYWORDS.test(haystack);

  // Try to extract version from first line
  const firstLine = (original || snapshotTitle).split('\n')[0].trim();
  const versionMatch =
    firstLine.match(/v?(\d+\.\d+(?:\.\d+)?)/) ||
    firstLine.match(/patch\s*(\d+\.\d+(?:\.\d+)?)/i);
  const version = versionMatch ? versionMatch[1] : '';

  if (looksLikePatch && version) confidence = 'high';
  else if (looksLikePatch) confidence = 'medium';
  else if (version) confidence = 'medium';

  if (!looksLikePatch && !version) {
    return { detected: false };
  }

  // Build a sensible title
  let title = snapshotTitle || firstLine || `Patch ${version}`;
  // Strip leading emoji markers if any
  title = title.replace(/^[\p{Emoji}\s]+/u, '').trim();
  if (!title && version) title = `Patch ${version}`;

  // Type detection
  let type = 'Hotfix';
  if (/major|big|big update/i.test(haystack)) type = 'Major';

  // Body: prefer embed description, else original content
  let body = snapshotDescription || original || '_No details provided._';

  // Date: try to find one in the embed footer / timestamp
  let date = new Date().toISOString().slice(0, 10);
  const tsMatch =
    snapshotTitle.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/) ||
    haystack.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/) ||
    haystack.match(
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2})\b/i
    );
  if (tsMatch) {
    const d = Date.parse(tsMatch[1].replace(/-/g, '/'));
    if (!Number.isNaN(d)) date = new Date(d).toISOString().slice(0, 10);
  } else if (msg.createdTimestamp) {
    date = new Date(msg.createdTimestamp).toISOString().slice(0, 10);
  }

  if (!version) {
    return {
      detected: true,
      confidence,
      parsed: null, // signal "needs manual fallback"
      reason: 'Could not find a version number in the message.',
    };
  }

  return {
    detected: true,
    confidence,
    parsed: { version, title, type, date, body },
  };
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

// ── Git commit + push to GitHub ────────────────────────────────────────
// All git commands run inside WORKSPACE (the cloned wiki repo).
async function commitAndPush(version, filepath) {
  const remote = `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`;

  // `cwd` makes every git command run inside the cloned repo.
  const opts = { cwd: WORKSPACE, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };

  // Make sure local identity is set
  await exec('git', ['config', 'user.name', GIT_USER_NAME], opts);
  await exec('git', ['config', 'user.email', GIT_USER_EMAIL], opts);

  // Re-point origin to the authenticated remote (in case clone left a
  // public URL behind)
  await exec('git', ['remote', 'set-url', 'origin', remote], opts);

  // Pull latest so a parallel push doesn't conflict
  await exec('git', ['fetch', 'origin', 'main'], opts);
  await exec('git', ['reset', '--hard', 'origin/main'], opts);

  // Use path relative to WORKSPACE for `git add`
  const relPath = path.relative(WORKSPACE, filepath).replace(/\\/g, '/');
  await exec('git', ['add', relPath], opts);
  await exec(
    'git',
    ['commit', '-m', `patch: ${version} (via Discord bot)`],
    opts
  );

  await exec('git', ['push', 'origin', 'main'], opts);
  console.log(`📤 Pushed commit for ${version} to GitHub`);
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

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📡 Watching channel ${CHANNEL_ID}`);
  try {
    await ensureRepo();
    console.log(`🚀 Bot ready to publish patches`);
  } catch (err) {
    console.error('❌ Failed to set up wiki repo:', err);
    // Don't exit — let the user see the error in Discord if they trigger
  }
});

client.on(Events.MessageCreate, async (msg) => {
  // Ignore bots, DMs, and other channels
  if (msg.author.bot) return;
  if (msg.channel.id !== CHANNEL_ID) return;

  // Permission gate: must have the editor role
  const hasRole = msg.member?.roles?.cache?.has(ALLOWED_ROLE_ID);
  if (!hasRole) {
    return msg.reply(
      '🚫 You need the **Wiki Editor** role to publish patches.'
    );
  }

  // ─── Decide which mode this message is in ─────────────────────────
  let parsed = null;
  let mode = 'unknown';

  // Mode 1: Explicit 📌 template (you typed it manually)
  if (msg.content.startsWith('📌')) {
    mode = 'template';
    try {
      parsed = parseTemplate(msg.content);
    } catch (err) {
      return msg.reply(`❌ Template error: ${err.message}`);
    }
  }
  // Mode 2: Forwarded message from another server (auto-forward)
  else if (
    msg.messageSnapshots?.size > 0 ||
    msg.messageReference?.guildId
  ) {
    mode = 'forwarded';
    const result = parseForwarded(msg);
    if (!result.detected) return; // silently ignore non-patch forwards
    if (!result.parsed) {
      return msg.reply(
        `🤔 Looks like a patch message but I couldn't extract a version.\n` +
          `Tip: forward with a version like "**v3.5.2**" in the first line, ` +
          `or reply to this message with a 📌 template.`
      );
    }
    parsed = result.parsed;
    // Only auto-publish on high confidence; otherwise ask for confirmation
    if (result.confidence !== 'high') {
      const confirm = await msg.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf5a623)
            .setTitle(`🤔 Possible patch detected — confirm?`)
            .setDescription(
              `Confidence: **${result.confidence}**\n` +
                `React with ✅ to publish, ❌ to ignore.`
            )
            .addFields(
              { name: 'Version', value: parsed.version, inline: true },
              { name: 'Type', value: parsed.type, inline: true },
              { name: 'Date', value: parsed.date, inline: true },
              { name: 'Title', value: parsed.title, inline: false },
              {
                name: 'Body preview',
                value: parsed.body.slice(0, 500) + (parsed.body.length > 500 ? '…' : ''),
                inline: false,
              }
            )
            .setTimestamp(),
        ],
      });
      await confirm.react('✅');
      await confirm.react('❌');
      try {
        const reaction = await confirm.awaitReactions({
          filter: (r, u) =>
            !u.bot && (r.emoji.name === '✅' || r.emoji.name === '❌'),
          max: 1,
          time: 5 * 60_000,
          errors: ['time'],
        });
        const first = reaction.first();
        if (!first || first.emoji.name === '❌') {
          await confirm.edit({ content: '🚫 Cancelled.', embeds: [] });
          return;
        }
      } catch {
        await confirm.edit({ content: '⌛ Confirmation timed out.', embeds: [] });
        return;
      }
    }
  }
  // Mode 3: nothing relevant — silently ignore
  else {
    return;
  }

  // ─── Publish ─────────────────────────────────────────────────────
  try {
    const filepath = writeMarkdown(parsed);

    const status = await msg.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(
            `⏳ Publishing patch ${parsed.version} (${mode} mode)…`
          )
          .addFields(
            { name: 'Title', value: parsed.title, inline: false },
            { name: 'Type', value: parsed.type, inline: true },
            { name: 'Date', value: parsed.date, inline: true }
          )
          .setTimestamp(),
      ],
    });

    await commitAndPush(parsed.version, filepath);
    await triggerRebuild(parsed.version);

    await status.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0x29f19c)
          .setTitle(`✅ Patch ${parsed.version} live on the site`)
          .setDescription(
            `Pushed to GitHub → Vercel is rebuilding now.\n` +
              `Live in ~30 s at \`/patchnote/${slugifyVersion(parsed.version)}/\``
          )
          .addFields(
            { name: 'Title', value: parsed.title, inline: false },
            { name: 'Type', value: parsed.type, inline: true },
            { name: 'Date', value: parsed.date, inline: true }
          )
          .setTimestamp(),
      ],
    });
  } catch (err) {
    await msg.reply(`❌ Could not publish patch: ${err.message}`);
    console.error(err);
  }
});

client.login(TOKEN);
