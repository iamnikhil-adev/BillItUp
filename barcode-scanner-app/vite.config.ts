import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return 'vendor-pdf';
            }
            if (id.includes('react-icons') || id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('localforage') || id.includes('date-fns')) {
              return 'vendor-storage';
            }
            if (id.includes('tesseract.js')) {
              return 'vendor-ocr';
            }
          }
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173
  }
})
