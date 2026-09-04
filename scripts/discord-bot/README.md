# DigiWiki Discord Patch Bot

A small Discord bot that watches a single channel for **patch-note
messages**, converts them into Markdown files, and triggers a Vercel
rebuild so the site updates within ~30 seconds.

## How it works

```
Discord message  →  bot parses template
                       ↓
            writes src/content/patchnote/<version>.md
                       ↓
       git add + commit + push  →  GitHub repo
                       ↓
            Vercel sees new commit → rebuilds site
                       ↓
       Live at https://<your-site>.vercel.app/patchnote/<version>/
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
1. Reply with a ⏳ "Publishing…" embed
2. Write `src/content/patchnote/<slug>.md`
3. `git add` + `git commit` + `git push` to GitHub
4. POST to the Vercel deploy hook (optional — Vercel auto-rebuilds on push)
5. Edit the original reply to ✅ "Patch live on the site"

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

## Required GitHub setup

The bot needs to push the new `.md` file to your repo so Vercel can rebuild.

1. Go to https://github.com/settings/tokens
2. **Generate new token** → **classic**
3. Note: `digiwiki-bot`
4. Expiration: your choice (90 days recommended)
5. Scopes: check **`repo`** (full repo access)
6. **Generate token** → copy it → `GITHUB_TOKEN`
7. `GITHUB_REPO` = `digiedaw/62` (owner/repo)

> ⚠️  This token has full write access to your repo. Keep it secret!

## Required Vercel setup (optional)

Vercel already auto-rebuilds on every `git push` to `main`, so this is optional.
If you want a faster/guaranteed rebuild, add a Deploy Hook:

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

The bot is already wired for same-repo deploy — Railway will see
`scripts/discord-bot/package.json` and use the included `railway.json`
+ `Procfile` to run `npm start`.

1. Go to https://railway.app/new → **Deploy from GitHub**
2. Select the `digiedaw/62` repo
3. **Variables** tab → paste all 7 env vars from `.env.example`
4. **Settings** tab → set **Root Directory** to `scripts/discord-bot`
   *(this is critical — Railway must build the bot folder, not the wiki)*
5. Railway auto-builds and starts the bot

The bot stays online 24/7 on Railway's free tier.

> 💡 Alternative: if Railway keeps complaining about the root dir, you can
> also create a **separate repo** containing only this folder and deploy that.
