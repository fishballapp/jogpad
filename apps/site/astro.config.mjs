import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jogpad.fishball.app',
  integrations: [sitemap({ filter: page => !page.endsWith('/og/') }), react()],
  vite: { plugins: [tailwindcss()] },
});
