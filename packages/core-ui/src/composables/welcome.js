import { api } from '../api.js'
import { onBeforeUnmount } from 'vue'
import { useQuasar } from 'quasar'
import KWelcomePrompt from '../components/prompt/KWelcomePrompt.vue'
import _ from 'lodash'
import config from 'config'
import { LocalStorage } from '../local-storage.js'

export function useWelcome () {
  const $q = useQuasar()

  function show () {
    const canShow = LocalStorage.get('welcome')
    // Introduction is only for logged users
    if (!(_.isNil(canShow) ? _.get(config, 'layout.welcome', true) : JSON.parse(canShow))) return
    $q.dialog({
      component: KWelcomePrompt
    }).onCancel(() => hide())
  }
  function hide () {
  }

  api.on('login', show)
  api.on('logout', hide)

  onBeforeUnmount(() => {
    api.off('login', show)
    api.off('logout', hide)
  })
}
