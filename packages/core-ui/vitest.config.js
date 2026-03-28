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
  resolve: {
    alias: {
      config: path.resolve(__dirname, 'test/config.js'),
      quasar: path.resolve(__dirname, 'node_modules/quasar/dist/quasar.esm.prod.js'),
      '@components': path.resolve(__dirname, 'src/components'),
      'jwt-decode': path.resolve(__dirname, 'node_modules/jwt-decode/build/jwt-decode.cjs.js'),
      'vue-i18n': path.resolve(__dirname, 'node_modules/vue-i18n/index.js'),
      'moment-timezone/builds/moment-timezone-with-data-10-year-range.js':
        path.resolve(__dirname, 'node_modules/moment-timezone/builds/moment-timezone-with-data-10-year-range.js'),
      'feathers-reactive': path.resolve(__dirname, 'node_modules/feathers-reactive/dist/index.cjs'),
      '@kalisio/feathers-automerge': path.resolve(__dirname, 'node_modules/@kalisio/feathers-automerge/index.js'),
      'path-browserify': path.resolve(__dirname, 'node_modules/path-browserify/index.js'),
      '@thumbmarkjs/thumbmarkjs': path.resolve(__dirname, 'node_modules/@thumbmarkjs/thumbmarkjs/dist/thumbmark.esm.js'),
      'vue-router': path.resolve(__dirname, 'node_modules/vue-router/dist/vue-router.mjs'),
      'ajv-i18n': path.resolve(__dirname, 'node_modules/ajv-i18n/localize/index.js')
    }
  },
  css: {
    preprocessorOptions: {
      scss: { api: 'legacy' },
      sass: { api: 'legacy' }
    }
  },
  test: {
    name: 'core-ui',
    environment: 'happy-dom',
    disableConsoleIntercept: true,
    setupFiles: ['./test/setup.js'],
    css: false,
    exclude: ['**/node_modules/**', '**/*.browser.test.js']
  }
}))
