import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { baseConfig } from '../../vite.base-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default mergeConfig(baseConfig, defineConfig({
  root: __dirname,
  plugins: [
    vue()
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.js'),
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: [
        'vue',
        'vue-router',
        'vue-i18n',
        'quasar',
        'config',
        'lodash',
        'loglevel',
        'debug',
        'moment',
        'moment-timezone/builds/moment-timezone-with-data-10-year-range.js',
        'chroma-js',
        'mathjs',
        'papaparse',
        'sanitize-html',
        'showdown',
        'sift',
        'localforage',
        'path-browserify',
        'jwt-decode',
        'ajv',
        'ajv-formats',
        'ajv-i18n',
        'ajv-keywords',
        'email-validator',
        'chart.js',
        'chartjs-adapter-moment',
        'chartjs-plugin-zoom',
        'chartjs-plugin-annotation',
        'chartjs-plugin-datalabels',
        'chartjs-chart-matrix',
        'socket.io-client',
        'feathers-reactive',
        '@feathersjs/client',
        '@kalisio/feathers-automerge',
        '@kalisio/feathers-s3',
        '@kalisio/core-common',
        '@thumbmarkjs/thumbmarkjs'
      ]
    }
  }
}))
