import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the same build works at a domain root and under /repo-name/ (GitHub Pages).
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'] },
})
