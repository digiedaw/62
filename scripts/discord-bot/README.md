# DigiWiki Discord Patch Bot

A small Discord bot that watches a single channel for **patch-note
messages**, converts them into Markdown files, and triggers a Vercel
rebuild so the site updates within ~30 seconds.

## How it works

```
Discord message  →  bot parses template  →  writes src/content/patchnote/<version>.md
                                              ↓
                                       POST to Vercel Deploy Hook
                                              ↓
                                       Astro rebuilds site
                                              ↓
                                       Live at https://62.vercel.app/patchnote/<version>/
```

## Message template

Copy-paste this into your Discord channel and edit the values:

```
📌 [3.5.2] — Bug fixes & balance pass
🏷️ Major
📅 20 August 2026
─────────────────
Added Omnimon Zwart Defeat.
Rebalanced SK digimon damage by -8%.
Fixed party invite bug.
```

| Line | Meaning |
|---|---|
| `📌 [<version>] — <title>` | version becomes URL slug; title is shown on cards |
| `🏷️ Major` or `🏷️ Hotfix` | drives the colored badge |
| `📅 <date>` | any parseable date (e.g. `20 August 2026`, `2026-08-20`) |
| `─────` | everything below becomes the Markdown body |

The bot will:
1. Reply with a ✅ embed showing what it parsed
2. Write `src/content/patchnote/<slug>.md`
3. POST to the Vercel deploy hook (site rebuilds in ~30 s)

## Required Discord setup

1. Go to https://discord.com/developers/applications
2. **New Application** → name it `DigiWiki Patch Bot`
3. **Bot** tab → **Add Bot** → copy the **Token** (this is `DISCORD_TOKEN`)
4. **Enable these Privileged Intents**:
   - ✅ Message Content Intent
   - ✅ Server Members Intent *(only if you check roles via `member.roles`)*
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Message History`, `Read Messages/View Channels`
6. Copy the invite URL and add the bot to your server
7. In Discord: right-click your `#patches` channel → **Copy Channel ID** → `CHANNEL_ID`
8. Create a role called **Wiki Editor** in your server → right-click it → **Copy Role ID** → `ALLOWED_ROLE_ID`

## Required Vercel setup

1. Vercel dashboard → your project → **Settings** → **Git** → **Deploy Hooks**
2. **Create Hook** → name `discord-bot` → branch `main`
3. Copy the URL → `VERCEL_DEPLOY_HOOK`

## Running locally

```bash
cd scripts/discord-bot
cp .env.example .env   # fill in the values
npm install
npm start
```

## Deploying to Railway.app (free tier)

1. Push this folder to its **own GitHub repo** (Railway deploys per-repo)
   - OR add a `railway.json` at the repo root
2. Go to https://railway.app/new → **Deploy from GitHub**
3. Select the repo
4. **Variables** tab → paste the four env vars from above
5. Railway auto-builds and starts the bot
6. Under **Settings** → set the start command to `npm start` if needed

The bot will stay online 24/7 on Railway's free tier.
