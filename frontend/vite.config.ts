import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'


// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'src': path.resolve(__dirname, './src'),
      'country-flag-icons/unicode': path.resolve(__dirname, '../node_modules/country-flag-icons/unicode/index.js'),
    }
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks - split heavy dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'vendor-charts': ['recharts'],
          'vendor-utils': ['date-fns', 'axios', 'dompurify'],
        },
      },
    },
    // Warn if chunks exceed 500KB
    chunkSizeWarningLimit: 500,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'react-phone-number-input'],
    esbuildOptions: {
      alias: {
        'country-flag-icons/unicode': path.resolve(__dirname, '../node_modules/country-flag-icons/unicode/index.js')
      }
    }
  }
})
