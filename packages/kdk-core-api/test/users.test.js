import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import _ from 'lodash'
import { authenticate } from '@feathersjs/authentication'
import { iff, disallow, isProvider, keep, discard } from 'feathers-hooks-common'
import request from 'superagent'
import core, { createApplication, hooks } from '../src/index.js'

describe('core:users', () => {
  let app, server, port, baseUrl, userIdAccessToken, emailAccessToken, phoneAccessToken, statelessAccessToken, adminAccessToken,
    userService, userObject, anotherUserObject, authenticationService

  beforeAll(async () => {
    app = createApplication()
    port = 3100 + Math.floor(Math.random() * 100)
    baseUrl = `http://localhost:${port}${app.get('apiPath')}`
    await app.db.connect()
    await app.db.instance.dropDatabase()
  })

  it('registers the services', async () => {
    await app.configure(core)
    authenticationService = app.getService('authentication')
    expect(authenticationService).toBeDefined()
    userService = app.getService('users')
    expect(userService).toBeDefined()
    // Register hooks, what we'd like is a configuration so that:
    // - information disclosure about internal user secrets like password is not permitted
    // - information disclosure about others users is not permitted for a given user unless it has 'administrator' permissions
    // - privilege escalation is not permitted for a given user
    // - user with 'administrator' permissions can change others user permissions
    // - changing others users information is not permitted for a given user unless it has 'administrator' permissions
    // - external calls can only target myself except if I have administrator permissions
    const isNotAdministrator = (context) => {
      const userPermissions = _.get(context.params, 'user.permissions')
      return userPermissions !== 'administrator'
    }
    userService.hooks({
      before: {
        all: authenticate('jwt'),
        get: [iff(hooks.isNotMe(), disallow('external'))],
        find: [iff(isProvider('external'), iff(isNotAdministrator, hooks.onlyMe()))],
        create: [iff(isProvider('external'), keep('name', 'email', 'profile', 'password'))],
        update: [disallow('external')],
        patch: [iff(isProvider('external'), iff(isNotAdministrator, hooks.onlyMe(), hooks.preventChanges(true, ['permissions'])))],
        remove: [iff(isProvider('external'), iff(isNotAdministrator, hooks.onlyMe()))]
      },
      after: {
        all: [iff(isProvider('external'), iff(hooks.isNotMe(), iff(isNotAdministrator, discard('permissions'))))]
      }
    })
    // Now app is configured launch the server
    server = await app.listen(port)
    await new Promise(resolve => server.once('listening', resolve))
  }, 10000)

  it('creates users and tokens with different subject identifiers', async () => {
    userObject = await userService.create({
      email: 'test@test.org',
      name: 'test user',
      permissions: 'user',
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
    statelessAccessToken = await authenticationService.createAccessToken({
      property: 'mycustomproperty'
    }, {
      subject: 'mycustomapp'
    })
    anotherUserObject = await userService.create({
      email: 'another_test@test.org',
      name: 'another test user',
      permissions: 'administrator',
      profile: { phone: '0623256969' }
    })
    adminAccessToken = await authenticationService.createAccessToken({
      sub: anotherUserObject._id
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
    response = await request
      .post(`${baseUrl}/authentication`)
      .send({ accessToken: statelessAccessToken, strategy: 'jwt' })
    accessToken = response.body.accessToken
    user = response.body.user
    expect(accessToken).toBeDefined()
    expect(accessToken).not.toBe(statelessAccessToken)
    expect(user).toBeUndefined()
  })

  it('checks for user information disclosure', async () => {
    // Should not retrieve internal user secret information like password in any case
    // Should not list others users in case of requests with identified user
    let response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + userIdAccessToken)
    let users = response.body.data
    expect(users.length).toBe(1)
    let user = users[0]
    expect(user._id).toBe(userObject._id.toString())
    expect(user.password).toBeUndefined()
    expect(user.previousPasswords).toBeUndefined()
    expect(user.permissions).toBeDefined()
    response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + emailAccessToken)
    users = response.body.data
    expect(users.length).toBe(1)
    user = users[0]
    expect(user._id).toBe(userObject._id.toString())
    expect(user.password).toBeUndefined()
    expect(user.previousPasswords).toBeUndefined()
    expect(user.permissions).toBeDefined()
    response = await request
      .get(`${baseUrl}/users`)
      .set('Authorization', 'Bearer ' + phoneAccessToken)
    users = response.body.data
    expect(users.length).toBe(1)
    user = users[0]
    expect(user._id).toBe(userObject._id.toString())
    expect(user.password).toBeUndefined()
    expect(user.previousPasswords).toBeUndefined()
    expect(user.permissions).toBeDefined()
    // Should not list users in case of request without identified user
    try {
      response = await request
        .get(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + statelessAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('MethodNotAllowed')).toBe(true)
    }
    // Should not get others users in case of requests with identified user
    try {
      response = await request
        .get(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + userIdAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('MethodNotAllowed')).toBe(true)
    }
    try {
      response = await request
        .get(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + emailAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('MethodNotAllowed')).toBe(true)
    }
    try {
      response = await request
        .get(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + phoneAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('MethodNotAllowed')).toBe(true)
    }
    try {
      response = await request
        .get(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + statelessAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('MethodNotAllowed')).toBe(true)
    }
  })

  it('checks for user information integrity', async () => {
    // Should not be able to update information of others users if not administrator
    try {
      await request
        .patch(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + userIdAccessToken)
        .send({ name: 'new name' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + emailAccessToken)
        .send({ name: 'new name' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + phoneAccessToken)
        .send({ name: 'new name' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + statelessAccessToken)
        .send({ name: 'new name' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('Forbidden')).toBe(true)
    }
    // Should be possible otherwise
    const response = await request
      .patch(`${baseUrl}/users/${userObject._id}`)
      .set('Authorization', 'Bearer ' + adminAccessToken)
      .send({ name: 'new name' })
    const user = response.body
    expect(user.name).toBe('new name')
  })

  it('checks for user privilege escalation', async () => {
    // Should not be able to upgrade user permissions when not administrator
    try {
      await request
        .patch(`${baseUrl}/users/${userObject._id}`)
        .set('Authorization', 'Bearer ' + userIdAccessToken)
        .send({ permissions: 'administrator' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('BadRequest')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${userObject._id}`)
        .set('Authorization', 'Bearer ' + emailAccessToken)
        .send({ permissions: 'administrator' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('BadRequest')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${userObject._id}`)
        .set('Authorization', 'Bearer ' + phoneAccessToken)
        .send({ permissions: 'administrator' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('BadRequest')).toBe(true)
    }
    try {
      await request
        .patch(`${baseUrl}/users/${userObject._id}`)
        .set('Authorization', 'Bearer ' + statelessAccessToken)
        .send({ permissions: 'administrator' })
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('Forbidden')).toBe(true)
    }
    // Should be possible otherwise
    const response = await request
      .patch(`${baseUrl}/users/${userObject._id}`)
      .set('Authorization', 'Bearer ' + adminAccessToken)
      .send({ permissions: 'manager' })
    const user = response.body
    expect(user.permissions).toBe('manager')
  })

  it('checks users removal', async () => {
    // Should not be able to remove others users if not administrator
    try {
      await request
        .delete(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + userIdAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .delete(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + emailAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .delete(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + phoneAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('NotFound')).toBe(true)
    }
    try {
      await request
        .delete(`${baseUrl}/users/${anotherUserObject._id}`)
        .set('Authorization', 'Bearer ' + statelessAccessToken)
    } catch (error) {
      // Not sure why but in this case the raised error is in text/html format
      expect(error.status).toBe(500)
      expect(error.response.text.includes('Forbidden')).toBe(true)
    }
    await userService.remove(userObject._id)
    await userService.remove(anotherUserObject._id)
  }, 5000)

  // Cleanup
  afterAll(async () => {
    if (server) await server.close()
    await app.db.instance.dropDatabase()
    await app.db.disconnect()
  })
})
