import BaseAction from '../BaseAction.js';
import { sendMail } from '../../../services/agntMail.js';
import { serviceFailure } from '../../../services/agntServices.js';

/**
 * Send Email, from the agent's own inbox on mail.agnt.gg. Included with AGNT Pro.
 *
 * Every send goes through the account's inbox and counts against the plan's
 * monthly email units. Only if mail.agnt.gg cannot be reached at all does it
 * fall back to the api.agnt.gg relay (agntMail.sendMail).
 */
class SendEmail extends BaseAction {
  static schema = {
    title: 'Send Email',
    category: 'action',
    type: 'send-email',
    icon: 'outbox',
    description: 'Sends an email from your agent inbox to a specified recipient with a customizable subject and body. Included with AGNT Pro.',
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
        description: 'An array of attachment objects: { filename, contentType, content (base64) }',
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Indicates whether the email was accepted for delivery',
      },
      messageId: {
        type: 'string',
        description: 'The delivery ID on mail.agnt.gg',
      },
      from: {
        type: 'string',
        description: 'The inbox address the email was sent from',
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
    this.validateParams(params);
    const isHtml = params.isHtml === true || params.isHtml === 'true' || (Array.isArray(params.isHtml) && params.isHtml.includes('true'));
    let attachments = params.attachments;
    if (typeof attachments === 'string' && attachments.trim()) {
      try { attachments = JSON.parse(attachments); } catch { attachments = undefined; }
    }
    try {
      const result = await sendMail({
        to: params.to,
        subject: params.subject,
        text: isHtml ? String(params.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : params.body,
        html: isHtml ? params.body : undefined,
        attachments: Array.isArray(attachments) ? attachments : undefined,
        workflowId: workflowEngine?.workflowId,
      });
      return this.formatOutput({ success: true, messageId: result.id, state: result.state, from: result.from, ...(result.via ? { via: result.via } : {}), error: null });
    } catch (error) {
      const failure = serviceFailure(error);
      return this.formatOutput({ success: false, messageId: null, from: null, error: failure.message || failure.error, ...failure });
    }
  }
}

export default new SendEmail();
