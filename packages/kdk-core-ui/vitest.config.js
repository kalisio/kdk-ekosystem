import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { baseConfig } from '../../vitest.base-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default mergeConfig(baseConfig, defineConfig({
  root: __dirname,
  plugins: [
    vue()
  ],
  test: {
    name: 'core-ui',
    environment: 'happy-dom'
  }
}))
