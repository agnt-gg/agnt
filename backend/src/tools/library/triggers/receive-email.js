import BaseTrigger from '../BaseTrigger.js';
import SimpleIMAP from '../../utils/SimpleIMAP.js';
import { EventEmitter } from 'events';

class ReceiveEmail extends BaseTrigger {
  static schema = {
    title: 'Receive Email',
    category: 'trigger',
    type: 'receive-email',
    icon: 'inbox',
    description:
      'This trigger node listens for incoming emails and triggers the workflow when a new email is received. Returns the received email details like from address, subject, body, etc.',
    parameters: {
      emailConfig: {
        type: 'string',
        inputType: 'select',
        options: ['Built-in Email', 'Custom IMAP'],
        description: 'Choose between built-in email or custom IMAP settings',
        default: 'Built-in Email',
      },
      emailAddress: {
        type: 'string',
        inputType: 'readonly',
        value: 'workflow-{{WORKFLOWID}}@{{IMAP_EMAIL_DOMAIN}}',
        description: 'The email address to monitor for incoming emails',
        conditional: {
          field: 'emailConfig',
          value: 'Built-in Email',
        },
      },
      imapUser: {
        type: 'string',
        inputType: 'text',
        description: 'IMAP username',
        conditional: {
          field: 'emailConfig',
          value: 'Custom IMAP',
        },
      },
      imapPassword: {
        type: 'string',
        inputType: 'password',
        description: 'IMAP password',
        conditional: {
          field: 'emailConfig',
          value: 'Custom IMAP',
        },
      },
      imapHost: {
        type: 'string',
        inputType: 'text',
        description: 'IMAP host',
        conditional: {
          field: 'emailConfig',
          value: 'Custom IMAP',
        },
      },
      imapPort: {
        type: 'string',
        inputType: 'text',
        description: 'IMAP port',
        default: '993',
        conditional: {
          field: 'emailConfig',
          value: 'Custom IMAP',
        },
      },
      imapTls: {
        type: 'string',
        inputType: 'text',
        description: "Use TLS (SSL) - set 'true' or 'false'",
        default: 'true',
        conditional: {
          field: 'emailConfig',
          value: 'Custom IMAP',
        },
      },
    },
    outputs: {
      from: {
        type: 'string',
        description: "The sender's email address",
      },
      to: {
        type: 'string',
        description: 'This workflow email address',
      },
      subject: {
        type: 'string',
        description: 'The subject of the received email',
      },
      body: {
        type: 'string',
        description: 'The body content of the received email',
      },
      attachments: {
        type: 'array',
        description: 'An array of attachment objects, if any',
      },
    },
  };

  constructor() {
    super('receive-email');
    this.imapConnection = null;
  }

  async setup(engine, node) {
    await super.setup(engine, node);

    const emailConfig = node.parameters.emailConfig;

    console.log('emailConfig', emailConfig);

    if (emailConfig === 'Custom IMAP') {
      const customImapConfig = {
        user: node.parameters.imapUser,
        password: node.parameters.imapPassword,
        host: node.parameters.imapHost,
        port: node.parameters.imapPort,
        tls: node.parameters.imapTls,
      };

      // Set up local email listening with SimpleIMAP
      this.imapConnection = new SimpleIMAP(customImapConfig);
      engine.receivers.email = this.imapConnection;

      try {
        await this.imapConnection.connect();
        console.log('Connected to custom IMAP server');

        // Watch mailbox for new emails
        await this.imapConnection.watchMailbox('INBOX', (numNewMsgs, email) => {
          engine.processWorkflowTrigger({
            type: 'email',
            from: email.from.text,
            to: email.to.text,
            subject: email.subject,
            body: email.text.trim(),
            html: email.html,
            attachments: email.attachments,
          });
        });

        console.log('IMAP mailbox watcher set up successfully');
      } catch (error) {
        console.error('Error connecting to custom IMAP server:', error);
        throw error;
      }
    } else {
      // For built-in email, use EventEmitter for remote email polling
      engine.receivers.email = new EventEmitter();
      engine.receivers.email.on('email', (emailData) => {
        engine.processWorkflowTrigger(emailData);
      });

      console.log('Built-in email receiver set up successfully');
    }
  }

  async validate(triggerData) {
    return 'subject' in triggerData && 'from' in triggerData;
  }

  async process(inputData) {
    return {
      from: inputData.from,
      to: inputData.to,
      subject: inputData.subject,
      body: inputData.body,
      html: inputData.html,
      attachments: inputData.attachments,
    };
  }

  async teardown() {
    // Clean up IMAP connection if it exists
    if (this.imapConnection) {
      try {
        await this.imapConnection.destroy();
        console.log('IMAP connection destroyed');
      } catch (error) {
        console.error('Error destroying IMAP connection:', error);
      }
      this.imapConnection = null;
    }

    await super.teardown();
  }
}

export default new ReceiveEmail();
