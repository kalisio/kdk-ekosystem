import { expect } from 'vitest'
import _ from 'lodash'
import google from 'googleapis'

const gmail = google.gmail('v1')

export const createMailerStub = (stubConfig) => {
  const emails = []
  return Object.assign({
    send: (mail, callback) => {
      emails.push(mail.data)
      callback(null, true)
    },
    // Helper function used to check if a given email has been sent
    // Erase it after check
    checkEmail: (user, fromValue, subjectValue, contentRegExs) => {
      expect(emails.length > 0).toBe(true)
      const message = emails[0]
      expect(message.from).toBe(fromValue)
      expect(message.subject).toBe(subjectValue)
      if (contentRegExs) {
        // Unify as array if single item
        if (!Array.isArray(contentRegExs)) contentRegExs = [contentRegExs]
        contentRegExs.forEach(contentRegEx => expect(contentRegEx.test(message.html)).toBe(true))
      }
      return emails.shift()
    },
    // Helper function used to check the number of sent emails
    checkNbEmails: (count) => {
      expect(emails.length).toBe(count)
    }
  }, stubConfig)
}

export const createGmailClient = (gmailApiConfig) => {
  return new Promise((resolve, reject) => {
    const jwtClient = new google.auth.JWT(
      gmailApiConfig.clientEmail,
      null,
      gmailApiConfig.privateKey,
      ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.readonly'], // an array of auth scopes
      gmailApiConfig.user
    )

    jwtClient.authorize((err, tokens) => {
      if (err) reject(err)
      else {
        // Helper function used to check if a given email has been retrieved in GMail inbox
        // Erase it after check
        jwtClient.checkEmail = function (user, fromValue, subjectValue, done) {
          gmail.users.messages.list({
            auth: jwtClient,
            userId: user.email
          }, (err, response) => {
            if (err) done(err)
            expect(response.messages).toBeDefined()
            expect(response.messages.length > 0).toBe(true)
            // console.log('Reading last email: ', response.messages[0].id)
            gmail.users.messages.get({
              auth: jwtClient,
              id: response.messages[0].id,
              userId: user.email
            }, (err, response) => {
              if (err) done(err)
              const message = response.payload
              expect(message).toBeDefined()
              expect(message.headers).toBeDefined()
              // console.log('Email retrieved')
              const from = _.find(message.headers, header => header.name === 'From')
              expect(from.value).toBe(fromValue)
              const subject = _.find(message.headers, header => header.name === 'Subject')
              expect(subject.value).toBe(subjectValue)
              // Remove message to not pollute the mailbox
              // or simply call done for debug
              // done()
              gmail.users.messages.delete({
                auth: jwtClient,
                id: response.id,
                userId: user.email
              }, (err, response) => {
                // console.log('Email deleted')
                done(err, message)
              })
            })
          })
        }
        resolve(jwtClient)
      }
    })
  })
}
