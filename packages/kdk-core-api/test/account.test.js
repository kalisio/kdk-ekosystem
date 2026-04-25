import { describe, it, expect, beforeAll, afterAll, assert } from 'vitest'
import { iff, when } from 'feathers-hooks-common'
import request from 'superagent'
import config from 'config'
import { addSubscription } from '@kalisio/feathers-webpush/client.js'
import core, { kdk, hooks } from '../src/index.js'
import { permissions } from '@kalisio/kdk-core-common'
// We now rely on mailer stub which is faster
// Integration testing with real email account shouuld be restricted to apps
// import { createGmailClient } from './utils.js'
import { createMailerStub } from './utils.js'

describe('core:account', () => {
  let app, server, port, baseUrl, token,
    userService, authenticationService, mailerService, accountService,
    gmailUser, mailerStub, userObject

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
    baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('is ES module compatible', () => {
    expect(typeof core).toBe('function')
  })

  it('registers the services', async () => {
    await app.configure(core)
    userService = app.getService('users')
    expect(userService).toBeDefined()
    userService.hooks({
      before: {
        create: [
          // Used for invitation
          when(hook => hook.data.sponsor,
            hooks.setExpireAfter(60), // A couple of seconds
            hooks.generatePassword(),
            // Keep track of clear password before hashing for testing purpose
            hooks.serialize([{ source: 'password', target: 'clearPassword' }]),
            hooks.hashPassword('password')),
          hooks.addVerification
        ]
      },
      after: {
        create: [
          // Invited users will be automatically verified upon first login
          iff(hook => !hook.result.sponsor, hooks.sendVerificationEmail),
          hooks.removeVerification
        ]
      }
    })
    authenticationService = app.getService('authentication')
    expect(authenticationService).toBeDefined()
    mailerService = app.getService('mailer')
    expect(mailerService).toBeDefined()
    accountService = app.getService('account')
    expect(accountService).toBeDefined()
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 5000)

  it('setup access to gmail', async () => {
    const gmailApiConfig = app.get('gmailApi')
    gmailUser = gmailApiConfig.user
    // gmailClient = await createGmailClient(gmailApiConfig)
  }, 5000)

  it('creates a user', async () => {
    let user = {
      email: gmailUser,
      password: 'Pass;word1',
      name: 'test-user'
    }
    await addSubscription(user, subscription, 'subscriptions')
    user = await userService.create(user)
    userObject = user
    expect(userObject.isVerified).toBeDefined()
    expect(userObject.isVerified).toBe(false)
    expect(userObject.verifyShortToken).toBeDefined()
    expect(userObject.consentTerms).toBeUndefined()
  }, 10000)

  it('check signup verification email', () => {
    mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Confirm your signup', [new RegExp(userObject.profile.name, 'g'), new RegExp(userObject.email, 'g'), new RegExp(userObject.verifyShortToken, 'g'), new RegExp(userObject.verifyShortToken, 'g')])
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Confirm your signup', done)
    }, 10000)
    */
  }, 15000)

  it('check password policy on user verifySignupSetPasswordShort', async () => {
    let error
    try {
      await accountService.create({
        action: 'verifySignupSetPasswordShort',
        value: {
          user: { email: gmailUser },
          token: userObject.verifyShortToken,
          password: '1234'
        }
      })
      assert.fail()
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.name).toBe('BadRequest')
    expect(error.data.translation.params.failedRules.length > 0).toBe(true)
  }, 5000)

  it('verify user signup', async () => {
    const user = await accountService.create({
      action: 'verifySignupShort',
      value: {
        user: { email: gmailUser },
        token: userObject.verifyShortToken
      }
    }, { user: userObject })
    userObject = user
    expect(userObject.isVerified).toBe(true)
  }, 5000)

  it('check signup verified email', () => {
    mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Thank you, your email has been verified', [new RegExp(userObject.email, 'g')])
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Thank you, your email has been verified', done)
    }, 10000)
    */
  }, 15000)

  it('ask password reset for a user', async () => {
    await accountService.create({
      action: 'sendResetPwd',
      value: { email: userObject.email }
    })
    // Because the account service filters for client hidden security attributes we need to fetch the user manually
    const users = await userService.find({ query: { email: gmailUser } })
    expect(users.data.length > 0).toBe(true)
    userObject = users.data[0]
    expect(userObject.resetShortToken).toBeDefined()
  }, 10000)

  it('check reset password request email', () => {
    const checkToken = (message) => {
      // Extract token from email beign compatible either wit mailer stub or gmail api
      message = message.html || Buffer.from(message.body.data, 'base64').toString()
      const tokenEntry = '<strong>'
      const firstTokenIndex = message.indexOf(tokenEntry) + tokenEntry.length
      const lastTokenIndex = message.indexOf('</strong>')
      token = message.substring(firstTokenIndex, lastTokenIndex)
    }
    const message = mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Reset your password', [new RegExp(userObject.profile.name, 'g'), new RegExp(userObject.email, 'g')])
    checkToken(message)
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Reset your password', checkToken)
    }, 20000)
    */
  }, 25000)

  it('check password policy on user password reset', async () => {
    let error
    try {
      await accountService.create({
        action: 'resetPwdShort',
        value: {
          user: { email: gmailUser },
          token,
          password: '1234'
        }
      })
      assert.fail()
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.name).toBe('BadRequest')
    expect(error.data.translation.params.failedRules.length > 0).toBe(true)
  }, 5000)

  it('reset user password', async () => {
    await accountService.create({
      action: 'resetPwdShort',
      value: {
        user: { email: gmailUser },
        token,
        password: 'Pass;word2'
      }
    })
    // Because the account service filters for client hidden security attributes we need to fetch the user manually
    const users = await userService.find({ query: { email: gmailUser } })
    expect(users.data.length > 0).toBe(true)
    userObject = users.data[0]
    expect(userObject.resetShortToken).toBeNull()
  }, 15000)

  it('check reset password email', () => {
    mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Your password was reset', [new RegExp(userObject.profile.name, 'g'), new RegExp(userObject.email, 'g')])
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Your password was reset', done)
    }, 10000)
    */
  }, 15000)

  it('authenticates a user with reset password', () => {
    return request
      .post(`${baseUrl}/authentication`)
      .send({ email: userObject.email, password: 'Pass;word2', strategy: 'local' })
      .then(response => {
        expect(response.body.accessToken).toBeDefined()
      })
  }, 5000)

  it('check password policy on user password change', async () => {
    let error
    try {
      await accountService.create({
        action: 'passwordChange',
        value: {
          user: { email: userObject.email },
          oldPassword: 'Pass;word2',
          password: '1234'
        }
      })
      assert.fail()
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.name).toBe('BadRequest')
    expect(error.data.translation.params.failedRules.length > 0).toBe(true)
  }, 5000)

  it('change user password', async () => {
    await accountService.create({
      action: 'passwordChange',
      value: {
        user: { email: userObject.email },
        oldPassword: 'Pass;word2',
        password: 'Pass;word1'
      }
    })
    // Because the account service filters for client hidden security attributes we need to fetch the user manually
    const users = await userService.find({ query: { email: gmailUser } })
    expect(users.data.length > 0).toBe(true)
    userObject = users.data[0]
    expect(userObject.resetShortToken).toBeNull()
  }, 15000)

  it('check changed password email', () => {
    mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Your password was changed', [new RegExp(userObject.profile.name, 'g'), new RegExp(userObject.email, 'g')])
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Your password was changed', done)
    }, 10000)
    */
  }, 15000)

  it('authenticates a user with changed password', () => {
    return request
      .post(`${baseUrl}/authentication`)
      .send({ email: userObject.email, password: 'Pass;word1', strategy: 'local' })
      .then(response => {
        expect(response.body.accessToken).toBeDefined()
      })
  }, 5000)

  it('ask user identity change', async () => {
    await accountService.create({
      action: 'identityChange',
      value: {
        user: { email: userObject.email },
        password: 'Pass;word1',
        changes: { email: gmailUser.replace('com', 'xyz') }
      }
    })
    // Because the account service filters for client hidden security attributes we need to fetch the user manually
    const users = await userService.find({ query: { email: gmailUser } })
    expect(users.data.length > 0).toBe(true)
    userObject = users.data[0]
    expect(userObject.verifyShortToken).toBeDefined()
    expect(userObject.verifyChanges).toBeDefined()
    expect(userObject.verifyChanges.email).toBeDefined()
  }, 10000)

  it('check identity change email', () => {
    mailerStub.checkEmail(userObject, mailerService.options.auth.user,
      'Your account information was changed', [new RegExp(userObject.profile.name, 'g'), new RegExp(gmailUser.replace('com', 'xyz'), 'g'), new RegExp(userObject.verifyShortToken, 'g')])
    mailerStub.checkNbEmails(0)
    // Add some delay to wait for email reception
    /*
    setTimeout(() => {
      gmailClient.checkEmail(userObject, mailerService.options.auth.user, 'Your account information was changed', done)
    }, 15000)
    */
  }, 20000)

  it('verify user changes', async () => {
    await accountService.create({
      action: 'verifySignupShort',
      value: {
        user: { email: gmailUser },
        token: userObject.verifyShortToken
      }
    })
    // Because the account service filters for client hidden security attributes we need to fetch the user manually
    const users = await userService.find({ query: { email: gmailUser.replace('com', 'xyz') } })
    expect(users.data.length > 0).toBe(true)
    userObject = users.data[0]
    expect(userObject.email).toBe(gmailUser.replace('com', 'xyz'))
  }, 5000)

  it('authenticates a user with changed identity', () => {
    return request
      .post(`${baseUrl}/authentication`)
      .send({ email: userObject.email, password: 'Pass;word1', strategy: 'local' })
      .then(response => {
        expect(response.body.accessToken).toBeDefined()
      })
  }, 5000)

  it('removes user', async () => {
    await userService.remove(userObject._id, { user: userObject })
  }, 5000)

  it('check invitation email does not exist', async () => {
    const response = await accountService.verifyEmail({ email: gmailUser })
    expect(response.status).toBe(404)
  })

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
