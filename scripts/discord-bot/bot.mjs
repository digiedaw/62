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
    return msg.reply('🚫 You need the **Wiki Editor** role to publish patches.');
  }

  // Quick pre-check: must start with the 📌 template emoji
  if (!msg.content.startsWith('📌')) return;

  try {
    const parsed = parseTemplate(msg.content);
    const filepath = writeMarkdown(parsed);

    // Acknowledge quickly so the user isn't staring at "Bot is typing…"
    const status = await msg.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf5a623)
          .setTitle(`⏳ Publishing patch ${parsed.version}…`)
          .addFields(
            { name: 'Title', value: parsed.title, inline: false },
            { name: 'Type', value: parsed.type, inline: true },
            { name: 'Date', value: parsed.date, inline: true }
          )
          .setTimestamp(),
      ],
    });

    // 1. Push to GitHub
    await commitAndPush(parsed.version, filepath);

    // 2. (Optional) trigger Vercel rebuild manually
    await triggerRebuild(parsed.version);

    // 3. Edit the status message with success
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
