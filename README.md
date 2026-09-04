# DIGIWIKI ⛩️ — an Astro-powered fan wiki

A themed wiki starter built with [Astro](https://astro.build) — dark "Digital World" theme, Markdown-driven content collections, zero JavaScript framework overhead.

## Quick start

```bash
npm install     # install dependencies
npm run dev     # start dev server at http://localhost:4321
npm run build   # production build into ./dist
npm run preview # preview the production build locally
```

## Adding a wiki page

Create a new Markdown file in `src/content/digimon/` (e.g. `biyomon.md`):

```markdown
---
title: "Biyomon"
emoji: "🐦"
icon: "digimon/Biyomon.png"  # optional — image path under /public (served as-is)
stage: "Rookie"          # Fresh | In-Training | Rookie | Champion | Ultimate | Mega
attribute: "Vaccine"
type: "Bird"
partner: "Sora Takenouchi"
description: "A bird Digimon whose wings are vestigial…"
tags: ["adventure", "partner"]
order: 20                # sorting position in lists/sidebar
---

## Overview

Write anything here in normal **Markdown**.
```

Save → the page appears automatically in the sidebar, the "All Entries" page,
the search index, and gets its own URL `/digimon/biyomon`.

## Theming

All colors/fonts live as CSS variables at the top of `src/styles/global.css`.
Change them to reskin the whole site — no component edits needed.

## Structure

```
src/
├── components/           Header, Footer, Sidebars, Cards
├── content.config.ts     Content-collection schemas (frontmatter validation)
├── content/digimon/      ← wiki pages (one .md file per entry)
├── content/accessories/  ← gear pages (goggles, digivices…)
├── layouts/              BaseLayout (header/footer shell)
├── pages/                index, wiki/, wiki/[slug], accessories/, search, about
└── styles/global.css     THE theme (edit me!)
```
