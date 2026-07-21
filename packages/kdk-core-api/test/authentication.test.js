import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import authentication from '@feathersjs/authentication'
import request from 'superagent'
import { initialize, createApplication } from '../src/index.js'

const { authenticate } = authentication.hooks

describe('core:authentication', () => {
  let app, server, port, baseUrl, userIdAccessToken, emailAccessToken, phoneAccessToken, statelessAccessToken,
    userService, userObject, authenticationService

  beforeAll(async () => {
    app = createApplication()
    port = 3100 + Math.floor(Math.random() * 100)
    baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('registers the services', async () => {
    await app.configure(initialize)
    authenticationService = app.getService('authentication')
    expect(authenticationService).toBeDefined()
    userService = app.getService('users')
    expect(userService).toBeDefined()
    // Register hooks
    userService.hooks({
      before: { all: authenticate('jwt') }
    })
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', resolve))
  }, 10000)

  it('unauthenticated user cannot access services', async () => {
    let error
    try {
      await request.get(`${baseUrl}/users`)
    } catch (e) {
      error = e
    }
    // Not sure why but in this case the raised error is in text/html format
    expect(error.status).toBe(500)
    expect(error.response.text.includes('NotAuthenticated')).toBe(true)
  })

  it('creates user tokens with different subject identifiers', async () => {
    userObject = await userService.create({
      email: 'test@test.org',
      name: 'test user',
      profile: { phone: '0623256968' }
    })
    userIdAccessToken = await authenticationService.createAccessToken({
      sub: userObject._id
    })
    emailAccessToken = await authenticationService.createAccessToken({
      sub: userObject.email
    })
    phoneAccessToken = await authenticationService.createAccessToken({
      sub: userObject.profile.phone
    })
  })

  it('checks all user tokens are recognized', async () => {
    let response = await request
      .post(`${baseUrl}/authentication`)
      .send({ accessToken: userIdAccessToken, strategy: 'jwt' })
    let accessToken = response.body.accessToken
    let user = response.body.user
    expect(accessToken).toBeDefined()
    expect(accessToken).not.toBe(userIdAccessToken)
    expect(user).toBeDefined()
    response = await request
      .post(`${baseUrl}/authentication`)
      .send({ accessToken: emailAccessToken, strategy: 'jwt' })
    accessToken = response.body.accessToken
    user = response.body.user
    expect(accessToken).toBeDefined()
    expect(accessToken).not.toBe(emailAccessToken)
    expect(user).toBeDefined()
    response = await request
      .post(`${baseUrl}/authentication`)
      .send({ accessToken: phoneAccessToken, strategy: 'jwt' })
    accessToken = response.body.accessToken
    user = response.body.user
    expect(accessToken).toBeDefined()
    expect(accessToken).not.toBe(phoneAccessToken)
    expect(user).toBeDefined()
  })

  it('checks all user tokens can be used to access services in header', async () => {
    let response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + userIdAccessToken)
    let users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
    response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + emailAccessToken)
    users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
    response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + phoneAccessToken)
    users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
  })

  it('checks all user tokens can be used to access services in query', async () => {
    let response = await request
      .get(`${baseUrl}/users`)
      .query({ jwt: userIdAccessToken })
    let users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
    response = await request
      .get(`${baseUrl}/users`)
      .query({ jwt: emailAccessToken })
    users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
    response = await request
      .get(`${baseUrl}/users`)
      .query({ jwt: phoneAccessToken })
    users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
  })

  it('creates a stateless token with a custom payload', async () => {
    statelessAccessToken = await authenticationService.createAccessToken({
      property: 'mycustomproperty'
    }, {
      subject: 'mycustomapp'
    })
  })

  it('checks stateless token is recognized', async () => {
    const response = await request
      .post(`${baseUrl}/authentication`)
      .send({ accessToken: statelessAccessToken, strategy: 'jwt' })
    const accessToken = response.body.accessToken
    const user = response.body.user
    expect(accessToken).toBeDefined()
    expect(accessToken).not.toBe(statelessAccessToken)
    expect(user).toBeUndefined()
    const payload = await authenticationService.verifyAccessToken(accessToken, app.get('authentication').jwtOptions)
    expect(payload.sub).toBe('mycustomapp')
    expect(payload.property).toBe('mycustomproperty')
  })

  it('checks stateless token can be used to access services in header', async () => {
    const response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + statelessAccessToken)
    const users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
  })

  it('checks stateless token can be used to access services in query', async () => {
    const response = await request
      .get(`${baseUrl}/users`)
      .query({ jwt: statelessAccessToken })
    const users = response.body.data
    expect(users).toBeDefined()
    expect(users[0]._id).toBe(userObject._id.toString())
  })

  it('removes user', async () => {
    await userService.remove(userObject._id)
  }, 5000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
