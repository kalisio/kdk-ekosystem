/* eslint-disable no-unused-expressions */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path, { dirname } from 'path'
import assert from 'assert'
import fs from 'fs-extra'
import request from 'superagent'
import fuzzySearch from 'feathers-mongodb-fuzzy-search'
import core, { createApplication, hooks, permissions, createMessagesService } from '../src/index.js'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('core:services', () => {
  let app, server, port, baseUrl, accessToken,
    usersService, userObject, authorisationService, messagesService, messageObject,
    spyUpdateAbilities

  beforeAll(async () => {
    // Register default rules for all users
    permissions.defineAbilities.registerHook(permissions.defineUserAbilities)

    app = createApplication()
    // Register hooks
    app.hooks({
      before: { all: hooks.authorise },
      error: { all: hooks.log }
    })
    port = 3100 + Math.floor(Math.random() * 100)
    baseUrl = `http://localhost:${port}${app.get('apiPath')}`
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
    // Register search hooks
    usersService.hooks({
      before: { find: [fuzzySearch({ fields: ['profile.name'] }), hooks.diacriticSearch()] }
    })
    // Create a global messages service for tests
    await createMessagesService.call(app)
    messagesService = app.getService('messages')
    expect(messagesService).toBeDefined()
    authorisationService = app.getService('authorisations')
    expect(authorisationService).toBeDefined()
    // Register escalation hooks
    authorisationService.hooks({
      before: { create: hooks.preventEscalation, remove: hooks.preventEscalation }
    })
    spyUpdateAbilities = vi.spyOn(authorisationService, 'updateAbilities')
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', () => resolve()))
  }, 10000)

  it('application healthcheck', async () => {
    const response = await request.get(`http://localhost:${port}/healthcheck`)
    expect(response.body).toEqual({ isRunning: true, isDatabaseRunning: true })
  }, 5000)

  it('register webhooks', () => {
    app.createWebhook('webhook', { filter: { service: { $in: ['users'] }, operation: 'get' } })
  })

  it('unauthorized user cannot access webhooks', async () => {
    let error
    await request
      .post(`${baseUrl}/webhooks/webhook`)
      .set('Content-Type', 'application/json')
      .send({ service: 'authorisations' })
      .catch(data => {
        /* FIXME: Not sure why but in this case the raised error is in text format
        const error = data.response.body
        expect(error).toBeDefined()
        expect(error.name).toBe('NotAuthenticated')
        */
        error = data
      })
    expect(error.status).toBe(500)
  }, 5000)

  it('unauthenticated user cannot access services', async () => {
    let error
    await messagesService.create({}, { checkAuthorisation: true })
      .catch(e => { error = e })
    expect(error).toBeDefined()
    expect(error.name).toBe('Forbidden')
  }, 5000)

  it('cannot create a user with a weak password', async () => {
    const [localStrategy] = app.service('api/authentication').getStrategies('local')
    const previousPassword = await localStrategy.hashPassword('weak;')

    await assert.rejects(() => usersService.create({
      email: 'test@test.org',
      password: 'weak;',
      previousPasswords: [previousPassword],
      name: 'maëlis'
    }), error => {
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
      expect(error.data.translation.params.failedRules).toEqual(['min', 'uppercase', 'digits', 'previous'])
      return true
    })

    await assert.rejects(() => usersService.create({
      email: 'test@test.org',
      password: '12345678',
      name: 'maëlis'
    }), error => {
      expect(error).toBeDefined()
      expect(error.name).toBe('BadRequest')
      expect(error.data.translation.params.failedRules).toEqual(['uppercase', 'lowercase', 'symbols', 'oneOf'])
      return true
    })
  }, 20000)

  it('creates a user', async () => {
    // Test password generation
    const hook = hooks.generatePassword()({ type: 'before', data: {}, params: {}, app })
    userObject = await usersService.create({
      email: 'test@test.org',
      password: hook.data.password,
      name: 'maëlis',
      profile: { phone: '0623256968' }
    }, { checkAuthorisation: true })
    expect(spyUpdateAbilities).toHaveBeenCalledOnce()
    spyUpdateAbilities.mockReset()
    // Keep track of clear password
    userObject.clearPassword = hook.data.password
    const users = await usersService.find({ query: { 'profile.name': 'maëlis' } })
    expect(users.data.length > 0).toBe(true)
    expect(users.data[0].email).toBeDefined()
    expect(users.data[0].clearPassword).toBeUndefined()
    expect(users.data[0].profile).toBeDefined()
    expect(users.data[0].profile.name).toBeDefined()
    expect(users.data[0].profile.description).toBeDefined()
  }, 10000)

  it('changing user password keeps password history', async () => {
    await usersService.patch(userObject._id.toString(), { password: userObject.password })
    expect(spyUpdateAbilities).toHaveBeenCalledOnce()
    spyUpdateAbilities.mockReset()
    const user = await usersService.get(userObject._id.toString())
    expect(user.previousPasswords).toBeDefined()
    expect(user.previousPasswords).toEqual([userObject.password])
  })

  it('authenticates a user', () => {
    return request
      .post(`${baseUrl}/authentication`)
      .send({ email: 'test@test.org', password: userObject.clearPassword, strategy: 'local' })
      .then(response => {
        accessToken = response.body.accessToken
        expect(accessToken).toBeDefined()
      })
  }, 10000)

  it('unauthorized service cannot be accessed through webhooks', async () => {
    let error
    await request
      .post(`${baseUrl}/webhooks/webhook`)
      .set('Content-Type', 'application/json')
      .send({ service: 'authorisations' })
      .set('Authorization', 'Bearer ' + accessToken)
      .catch(data => {
        error = data.response.body
      })
    expect(error).toBeDefined()
    expect(error.name).toBe('Forbidden')
  }, 5000)

  it('unauthorized service operation cannot be accessed through webhooks', async () => {
    let error
    await request
      .post(`${baseUrl}/webhooks/webhook`)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({ service: 'users', operation: 'create' })
      .catch(data => {
        error = data.response.body
      })
    expect(error).toBeDefined()
    expect(error.name).toBe('Forbidden')
  }, 5000)

  it('authenticated user can access service operation through webhooks', () => {
    return request
      .post(`${baseUrl}/webhooks/webhook`)
      .set('Content-Type', 'application/json')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({ service: 'users', id: userObject._id, operation: 'get' })
      .then(response => {
        const user = response.body
        expect(user._id.toString() === userObject._id.toString()).toBe(true)
      })
  }, 5000)

  it('authenticated user can access services', () => {
    return usersService.find({ query: {}, params: { user: userObject, checkAuthorisation: true } })
      .then(users => {
        expect(users.data.length === 1).toBe(true)
      })
  })

  it('get user profile', () => {
    return usersService.find({ query: { $select: ['profile'] } })
      .then(users => {
        expect(users.data.length > 0).toBe(true)
        expect(users.data[0].name).toBeUndefined()
        expect(users.data[0].profile.name).toBeDefined()
        expect(users.data[0].profile.description).toBeDefined()
        expect(users.data[0].profile.phone).toBeDefined()
      })
  })

  it('search user profile', async () => {
    const hook = hooks.generatePassword()({ type: 'before', data: {}, params: {}, app })
    const user = await usersService.create({
      email: 'anothertest@test.org',
      password: hook.data.password,
      name: 'maelis',
      profile: { phone: '0623256968' }
    })
    spyUpdateAbilities.mockReset()
    const allUsers = await usersService.find({ query: { 'profile.name': { $search: 'Mae' } } })
    // Diacritic should be more specific
    const singleUsers = await usersService.find({ query: { 'profile.name': { $search: 'Maë' } } })
    await usersService.remove(user._id)
    expect(allUsers.data.length === 2).toBe(true)
    expect(singleUsers.data.length === 1).toBe(true)
  }, 10000)

  it('creates a user message', async () => {
    const message = await messagesService.create({
      title: 'Title',
      body: 'Body',
      author: 'manager'
    })
    messageObject = message
    expect(messageObject).toBeDefined()
    const messages = await messagesService.find({ query: { title: 'Title' } })
    expect(messages.data.length > 0).toBe(true)
    expect(messages.data[0].title).toBe('Title')
  }, 5000)

  it('creates an authorisation', async () => {
    const authorisation = await authorisationService.create({
      scope: 'authorisations',
      permissions: 'manager',
      subjects: userObject._id.toString(),
      subjectsService: 'users',
      resource: messageObject._id.toString(),
      resourcesService: 'messages'
    }, {
      user: userObject
    })
    expect(authorisation).toBeDefined()
    expect(spyUpdateAbilities).toHaveBeenCalledOnce()
    spyUpdateAbilities.mockReset()
    userObject = await usersService.get(userObject._id.toString())
    expect(userObject.authorisations).toBeDefined()
    expect(userObject.authorisations.length > 0).toBe(true)
    expect(userObject.authorisations[0].permissions).toEqual('manager')
  }, 5000)

  it('cannot escalate an authorisation when creating', async () => {
    let error
    await authorisationService.create({
      scope: 'authorisations',
      permissions: 'owner',
      subjects: userObject._id.toString(),
      subjectsService: 'users',
      resource: messageObject._id.toString(),
      resourcesService: 'messages'
    }, {
      user: userObject,
      checkEscalation: true
    })
      .catch(e => { error = e })
    expect(error).toBeDefined()
    expect(error.name).toBe('Forbidden')
  })

  it('cannot escalate an authorisation when removing', async () => {
    // Fake lower permission level
    userObject.authorisations[0].permissions = 'member'
    let error
    await authorisationService.remove(messageObject._id, {
      query: {
        scope: 'authorisations',
        subjects: userObject._id.toString(),
        subjectsService: 'users',
        resourcesService: 'messages'
      },
      user: userObject,
      checkEscalation: true
    })
      .catch(e => {
        error = e
        // Restore permission level
        userObject.authorisations[0].permissions = 'manager'
      })
    expect(error).toBeDefined()
    expect(error.name).toBe('Forbidden')
  })

  it('removes an authorisation', async () => {
    const authorisation = await authorisationService.remove(messageObject._id, {
      query: {
        scope: 'authorisations',
        subjects: userObject._id.toString(),
        subjectsService: 'users',
        resourcesService: 'messages'
      },
      user: userObject,
      checkEscalation: true
    })
    expect(authorisation).toBeDefined()
    expect(spyUpdateAbilities).toHaveBeenCalledOnce()
    spyUpdateAbilities.mockReset()
    const user = await usersService.get(userObject._id.toString())
    expect(user.authorisations).toBeDefined()
    expect(user.authorisations.length === 0).toBe(true)
  }, 5000)

  it('removes a user message', async () => {
    const message = await messagesService.remove(messageObject._id.toString())
    expect(message).toBeDefined()
    const messages = await messagesService.find({})
    expect(messages.data.length === 0).toBe(true)
  }, 5000)

  it('unauthenticates a user', () => {
    return request
      .del(`${baseUrl}/authentication`)
      .set('Content-Type', 'application/json')
      .set('Authorization', accessToken)
      .then(response => {
        expect(response.status).toBe(200)
      })
  })

  it('removes a user', async () => {
    await usersService.remove(userObject._id, {
      user: userObject,
      checkAuthorisation: true
    })
    const users = await usersService.find({ query: { name: 'maëlis' } })
    expect(users.data.length === 0).toBe(true)
    const messages = await messagesService.find({ query: { title: 'Title' } })
    expect(messages.data.length === 0).toBe(true)
  }, 5000)

  it('registers the log options', async () => {
    // Inserted manually
    const log = 'This is a log test'
    // Raised by Forbidden error in hooks
    const hookLog = 'You are not allowed to access service'
    const now = new Date()
    app.logger.info(log)
    // FIXME: need to let some time to proceed with log file
    await new Promise(resolve => setTimeout(resolve, 2500))
    const logFilePath = path.join(__dirname, 'test-log-' + now.toISOString().slice(0, 10) + '.log')
    const content = await fs.readFile(logFilePath, 'utf8')
    expect(content.includes(log)).toBe(true)
    expect(content.includes(hookLog)).toBe(true)
  }, 5000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
