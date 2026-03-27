import _ from 'lodash'
import config from 'config'
import { addSubscription, removeSubscription } from '@kalisio/feathers-webpush/client.js'
import core, { kdk, hooks } from '../src/index.js'
import { permissions } from '@kalisio/core-common'
// We now rely on mailer stub which is faster
// Integration testing with real email account shouuld be restricted to apps
// import { createGmailClient } from './utils.js'
import { createMailerStub } from './utils.js'

describe('core:push', () => {
  let app, server, port, mailerStub, gmailUser, user,
    mailerService, usersService, pushService

  const subscription = {
    endpoint: process.env.SUBSCRIPTION_ENDPOINT,
    keys: {
      p256dh: process.env.SUBSCRIPTION_KEY_P256DH,
      auth: process.env.SUBSCRIPTION_KEY_AUTH
    },
    browser: {
      name: 'chrome'
    }
  }
  const expiredSubscription = {
    endpoint: process.env.EXPIRED_SUBSCRIPTION_ENDPOINT,
    keys: {
      p256dh: process.env.EXPIRED_SUBSCRIPTION_KEY_P256DH,
      auth: process.env.EXPIRED_SUBSCRIPTION_KEY_AUTH
    },
    browser: {
      name: 'chrome'
    }
  }

  beforeAll(async () => {
    // Register all default hooks for authorisation
    // Default rules for all users
    permissions.defineAbilities.registerHook(permissions.defineUserAbilities)
    // Then rules for notifications
    permissions.defineAbilities.registerHook(permissions.defineUserAbilities)

    // Override mailer to use a stub
    mailerStub = createMailerStub({
      // Add required config to make account service work
      auth: { user: config.mailer.auth.user },
      templateDir: config.mailer.templateDir
    })
    app = kdk({
      mailer: mailerStub
    })
    // Register authorisation/log hook
    app.hooks({
      before: { all: [hooks.authorise] },
      error: { all: hooks.log }
    })
    port = app.get('port')
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('is ES module compatible', () => {
    expect(typeof core).toBe('function')
  })

  it('registers the services', async () => {
    await app.configure(core)
    usersService = app.getService('users')
    expect(usersService).toBeDefined()
    usersService.hooks({
      before: {
        remove: [hooks.unregisterDevices]
      },
      after: {
        patch: [hooks.sendNewSubscriptionEmail]
      }
    })
    mailerService = app.getService('mailer')
    expect(mailerService).toBeDefined()
    pushService = app.getService('push')
    expect(pushService).toBeDefined()
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 10000)

  it('setup access to gmail', async () => {
    const gmailApiConfig = app.get('gmailApi')
    gmailUser = gmailApiConfig.user
    // gmailClient = await createGmailClient(gmailApiConfig)
  }, 5000)

  it('create a user', async () => {
    const usr = await usersService.create({
      email: gmailUser,
      password: 'Pass;word1',
      name: 'user'
    }, { noVerificationEmail: true })
    user = usr
  }, 5000)

  it('a user should be able to register its subscriptions', async () => {
    const previousUser = _.cloneDeep(user)
    await addSubscription(user, subscription, 'subscriptions')
    // Subscriptions change detection requires the previous user to be set
    await usersService.patch(user._id, { subscriptions: user.subscriptions }, { user: previousUser })
    expect(user.subscriptions).toBeDefined()
    expect(user.subscriptions.length === 1).toBe(true)
    expect(user.subscriptions[0].endpoint).toBe(subscription.endpoint)
    expect(user.subscriptions[0].keys.p256dh).toBe(subscription.keys.p256dh)
    expect(user.subscriptions[0].keys.auth).toBe(subscription.keys.auth)
    expect(user.subscriptions[0].browser.name).toBe(subscription.browser.name)
  }, 10000)

  it('check new subscription emails', () => {
    // Add some delay to wait for email reception
    mailerStub.checkEmail(user.subscriptions[0], mailerService.options.auth.user,
      'Security alert - new browser detected', [new RegExp(user.profile.name, 'g'), new RegExp(subscription.browser.name, 'g')])
    mailerStub.checkNbEmails(1)
    mailerStub.checkEmail(user.subscriptions[0], mailerService.options.auth.user,
      'Security alert - new browser detected', [new RegExp(user.profile.name, 'g'), new RegExp(subscription.browser.name, 'g')])
    mailerStub.checkNbEmails(0)
  }, 15000)

  it('publishes a notification on the user\'s browser', async () => {
    const operation = await pushService.create({
      notification: { title: 'title' },
      subscriptionService: 'api/users',
      subscriptionProperty: 'subscriptions',
      subscriptionFilter: { _id: user._id }
    })
    expect(operation).toBeDefined()
    expect(operation.succesful[0].statusCode).toBe(201)
  }, 10000)

  it('delete expired subscriptions', async () => {
    // Add expired subscription
    await addSubscription(user, expiredSubscription, 'subscriptions')
    await usersService.patch(user._id, { subscriptions: user.subscriptions })
    expect(user.subscriptions).toBeDefined()
    expect(user.subscriptions.length === 2).toBe(true)
    // Send push notification
    const operation = await pushService.create({
      notification: { title: 'title' },
      subscriptionService: 'api/users',
      subscriptionProperty: 'subscriptions',
      subscriptionFilter: { _id: user._id }
    })
    const users = await usersService.find({ query: { email: gmailUser } })
    expect(users.data.length > 0).toBe(true)
    user = users.data[0]
    // Check that expired subscriptions have been deleted
    expect(user.subscriptions.length === 1).toBe(true)
    expect(operation).toBeDefined()
    expect(operation.succesful.length === 1).toBe(true)
    expect(operation.succesful[0].statusCode).toBe(201)
    expect(operation.failed.length === 1).toBe(true)
    expect((operation.failed[0].statusCode === 404) || (operation.failed[0].statusCode === 410)).toBe(true)
    expect(operation.failed[0].endpoint).toBe(expiredSubscription.endpoint)
  }, 10000)

  it('a user should be able to delete its subscription', async () => {
    await Promise.all(user.subscriptions.map(subscription => removeSubscription(user, subscription, 'subscriptions')))
    expect(user.subscriptions.length === 0).toBe(true)
  }, 10000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
