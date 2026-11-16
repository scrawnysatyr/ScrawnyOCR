import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Strip >25 MiB ORT WASM binaries from dist (loaded via CDN wasmPaths instead). */
function excludeLargeOrtWasm(): Plugin {
  return {
    name: 'exclude-large-ort-wasm',
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(key)) {
          delete bundle[key];
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), excludeLargeOrtWasm()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'esnext',
  },
});

