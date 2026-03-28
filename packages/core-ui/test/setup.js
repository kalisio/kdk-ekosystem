import { installQuasarPlugin } from '@quasar/quasar-app-extension-testing-unit-vitest'
import { config } from '@vue/test-utils'
import { Schema } from '@kalisio/core-common'

installQuasarPlugin()

// Initialize AJV schema validator used by KForm / useSchema
Schema.initialize()

config.global.mocks = {
  $tie: (str) => str,
  $t: (str) => str
}
