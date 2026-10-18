// Lovable's wrapper already injects tanstackStart, react, tailwind, tsconfig-paths and the @ alias — do not add them.
// Deployment: Netlify's official TanStack Start plugin handles server functions + SSR. The wrapper's default
// Nitro/Cloudflare target is switched off (nitro: false) so Netlify is the single deployment target.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import netlify from "@netlify/vite-plugin-tanstack-start";

export default defineConfig({
  nitro: false,
  plugins: [netlify()],
  tanstackStart: {
    // Keep src/server.ts as the SSR entry (error-page wrapper).
    server: { entry: "server" },
  },
});
