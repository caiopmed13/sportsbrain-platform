// sportsbrain-api/vitest.config.js
// F2.94: src/**/*.test.js são manual runners com node:assert (não usam vitest).
// Vitest agora roda só tests/** (que usa describe/it nativo).
// Manual runners rodam via node scripts separados.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
