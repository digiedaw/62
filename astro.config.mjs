// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import { remarkAdmonition } from './src/lib/remark-admonitions.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://example.com',
  output: 'static',

  // Hide the floating Astro Dev Toolbar in `npm run dev`
  // (it never appears in production builds anyway).
  devToolbar: {
    enabled: false,
  },

  markdown: {
    remarkPlugins: [remarkDirective, remarkAdmonition],
  },
});
