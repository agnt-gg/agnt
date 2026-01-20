import BaseAction from '../BaseAction.js';
import nodemailer from 'nodemailer';
import axios from 'axios';

class SendEmail extends BaseAction {
  static schema = {
    title: 'Send Email',
    category: 'action',
    type: 'send-email',
    icon: 'outbox',
    description: 'This action node sends an email to a specified recipient with a customizable subject and body.',
    parameters: {
      to: {
        type: 'string',
        description: "The recipient's email address",
      },
      subject: {
        type: 'string',
        description: 'The subject of the email',
      },
      body: {
        type: 'string',
        inputType: 'textarea',
        description: 'The body content of the email',
      },
      isHtml: {
        inputType: 'checkbox',
        options: ['true'],
        description: 'Whether the body content is HTML',
      },
      attachments: {
        type: 'array',
        inputType: 'textarea',
        description: 'An array of attachment objects',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the email was sent successfully',
      },
      content: {
        type: 'Object',
        description: 'The content of the sent email',
      },
      messageId: {
        type: 'string',
        description: 'The unique message ID of the sent email',
      },
      serverResponse: {
        type: 'object',
        description: 'Server response details including status, statusText, data, and headers',
      },
      error: {
        type: 'null',
        description: 'Error message if the email sending failed',
      },
    },
  };

  constructor() {
    super('sendEmail');
  }
  async execute(params, inputData, workflowEngine) {
    const workflowId = workflowEngine.workflowId;
    const response = await axios.post(`${process.env.REMOTE_URL}/email/send`, {
      params,
      workflowId,
    });
    return this.formatOutput({
      success: true,
      content: params,
      messageId: response.data.messageId,
      serverResponse: {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        headers: response.headers,
      },
      error: null,
    });
  }
  validateParams(params) {
    if (!params.to || !params.subject || !params.body) {
      throw new Error('To, subject, and body are required for sending an email');
    }
  }
}

export default new SendEmail();
