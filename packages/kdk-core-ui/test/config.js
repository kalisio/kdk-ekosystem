export default {
  apiPath: '/api',
  apiTimeout: 30000,
  transport: 'websocket',
  locale: {
    fallback: 'en'
  },
  logs: {
    level: 'info'
  },
  layout: {
    page: { visible: true },
    panes: {
      left: { opener: true },
      top: { opener: true, visible: true },
      right: { opener: true },
      bottom: { opener: true }
    },
    fab: { visible: true }
  }
}
