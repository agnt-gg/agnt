import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { EventEmitter } from 'events';

class simpleIMAP extends EventEmitter {
  constructor(config) {
    super();
    this.imap = new Imap(config);
    this.imap.once('error', (err) => {
      console.error('IMAP connection error:', err);
      this.emit('error', err);
    });
    this.imap.on('end', () => {
      console.log('IMAP connection ended');
      this.emit('end');
    });
  }

  // PUBLIC METHODS
  async getEmails(mailbox = 'INBOX', criteria = ['UNSEEN'], options = {}) {
    const prefixedMailbox = this._prefixMailbox(mailbox);
    await this._openBox(prefixedMailbox);
    return new Promise((resolve, reject) => {
      this.imap.search(criteria, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        
        const fetchOptions = {
          bodies: ['HEADER', 'TEXT'],
          markSeen: options.markSeen || false,
        };

        const emails = [];
        const f = this.imap.fetch(results, fetchOptions);

        f.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (err) {
                console.error('Error parsing email:', err);
                return;
              }
              emails.push(parsed);
            });
          });
        });

        f.once('error', reject);
        f.once('end', () => resolve(emails));
      });
    });
  }
  async getNewEmails(mailbox, count) {
    console.log(`Fetching ${count} new emails from ${mailbox}`);
    const prefixedMailbox = this._prefixMailbox(mailbox);
    await this._openBox(prefixedMailbox);
    return new Promise((resolve, reject) => {
      this.imap.search(['UNSEEN'], (err, results) => {
        if (err) {
          console.error('Error searching for unseen emails:', err);
          reject(err);
          return;
        }
        
        console.log(`Found ${results.length} unseen emails`);
        
        if (results.length === 0) {
          resolve([]);
          return;
        }
  
        const recentEmailIds = results.slice(-count);
        console.log(`Fetching ${recentEmailIds.length} recent emails`);
        const fetchOptions = {
          bodies: ['HEADER', 'TEXT', ''],
          markSeen: false,
        };
  
        const emailPromises = [];
        const f = this.imap.fetch(recentEmailIds, fetchOptions);
  
        f.on('message', (msg) => {
          console.log('Processing a message');
          const emailPromise = new Promise((resolveEmail) => {
            msg.on('body', (stream, info) => {
              if (info.which === '') {
                simpleParser(stream, (err, parsed) => {
                  if (err) {
                    console.error('Error parsing email:', err);
                    resolveEmail(null);
                    return;
                  }
                  console.log('Email parsed successfully');
                  resolveEmail(parsed);
                });
              }
            });
          });
          emailPromises.push(emailPromise);
        });
  
        f.once('error', (fetchError) => {
          console.error('Error fetching emails:', fetchError);
          reject(fetchError);
        });
  
        f.once('end', async () => {
          const emails = await Promise.all(emailPromises);
          const validEmails = emails.filter(email => email !== null);
          console.log(`Fetch completed. Retrieved ${validEmails.length} emails`);
          resolve(validEmails);
        });
      });
    });
  }
  async getLatestEmail(mailbox = 'INBOX') {
    const prefixedMailbox = this._prefixMailbox(mailbox);
    await this._openBox(prefixedMailbox);
    return new Promise((resolve, reject) => {
      this.imap.search(['UNSEEN'], (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (results.length === 0) {
          resolve(null);
          return;
        }

        const latestEmailId = results[results.length - 1];
        const fetchOptions = {
          bodies: ['HEADER', 'TEXT', ''],
          markSeen: false,
        };

        const f = this.imap.fetch(latestEmailId, fetchOptions);

        f.on('message', (msg) => {
          msg.on('body', (stream, info) => {
            if (info.which === '') {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  console.error('Error parsing email:', err);
                  reject(err);
                  return;
                }
                resolve(parsed);
              });
            }
          });
        });

        f.once('error', reject);
      });
    });
  }
  async moveEmails(sourceMailbox, destMailbox, messageIds) {
    const prefixedSourceMailbox = this._prefixMailbox(sourceMailbox);
    const prefixedDestMailbox = this._prefixMailbox(destMailbox);
    await this._openBox(prefixedSourceMailbox);
    return new Promise((resolve, reject) => {
      this.imap.move(messageIds, prefixedDestMailbox, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  async deleteEmails(mailbox, messageIds) {
    const prefixedMailbox = this._prefixMailbox(mailbox);
    await this._openBox(prefixedMailbox);
    return new Promise((resolve, reject) => {
      this.imap.addFlags(messageIds, '\\Deleted', (err) => {
        if (err) {
          reject(err);
          return;
        }
        this.imap.expunge((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
  async watchMailbox(mailbox, callback) {
    const prefixedMailbox = this._prefixMailbox(mailbox);
    await this._openBox(prefixedMailbox);
    this.imap.on('mail', async (numNewMsgs) => {
      console.log(`Received ${numNewMsgs} new messages`);
      try {
        const emails = await this.getNewEmails(mailbox, numNewMsgs);
        console.log(`Retrieved ${emails.length} new emails`);
        if (emails.length > 0) {
          emails.forEach((email, index) => {
            console.log(`Processing email ${index + 1} of ${emails.length}`);
            callback(emails.length, email);
          });
        } else {
          console.log('No new emails to process');
        }
      } catch (error) {
        console.error('Error processing new emails:', error);
      }
    });
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        console.log('IMAP connection established');
        resolve();
      });
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }
  disconnect() {
    return new Promise((resolve) => {
      this.imap.end();
      this.imap.once('end', () => {
        console.log('IMAP connection ended');
        resolve();
      });
    });
  }
  destroy() {
    return new Promise((resolve) => {
      if (this.imap.state !== 'disconnected') {
        this.imap.once('end', () => {
          console.log('IMAP connection destroyed');
          resolve();
        });
        this.imap.end();
      } else {
        console.log('IMAP connection already disconnected');
        resolve();
      }
    });
  }
  listMailboxes() {
    return new Promise((resolve, reject) => {
      this.imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(boxes);
      });
    });
  }
  
  // PRIVATE METHODS
  _openBox(mailbox) {
    const prefixedMailbox = this._prefixMailbox(mailbox);
    return new Promise((resolve, reject) => {
      this.imap.openBox(prefixedMailbox, false, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });
  }
  _prefixMailbox(mailbox) {
    return mailbox.toUpperCase().startsWith('INBOX.') ? mailbox : `INBOX.${mailbox}`;
  }
}

export default simpleIMAP;