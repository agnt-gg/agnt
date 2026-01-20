import EventEmitter from 'events';
import WorkflowEngine from '../workflow/WorkflowEngine.js';
import WorkflowModel from '../models/WorkflowModel.js';
import ProcessManager from '../workflow/ProcessManager.js';
import AuthManager from '../services/auth/AuthManager.js';
import SimpleIMAP from './utils/SimpleIMAP.js';
import dotenv from 'dotenv';

dotenv.config();

const calculateNextSpecificTime = (specificTime, specificDays) => {
  const now = new Date();
  const [hours, minutes] = specificTime.split(':').map(Number);
  const targetTime = new Date(now);
  targetTime.setHours(hours, minutes, 0, 0);

  if (targetTime <= now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  while (!specificDays.includes(getDayName(targetTime.getDay()))) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  return targetTime.getTime() - now.getTime();
};

const getDayName = (dayIndex) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayIndex];
};

export default {
  triggers: {
    'generic-trigger': {
      validate: () => true, // Always valid
      process: (inputData) => inputData, // Pass through all input data
    },
    // "receive-email": {
    //   setup: async (engine) => {
    //     engine.receivers.email = new EventEmitter();
    //     engine.receivers.email.on("email", (emailData) => {
    //       engine.processWorkflowTrigger(emailData);
    //     });
    //   },
    //   validate: (triggerData) =>
    //     "subject" in triggerData && "from" in triggerData,
    //   process: (inputData) => ({
    //     from: inputData.from,
    //     to: inputData.to,
    //     subject: inputData.subject,
    //     body: inputData.body,
    //     html: inputData.html,
    //     attachments: inputData.attachments,
    //   }),
    // },
    'receive-email': {
      setup: async (engine, node) => {
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

          // Set up local email listening
          engine.receivers.email = new SimpleIMAP(customImapConfig);

          engine.receivers.email
            .connect()
            .then(() => {
              console.log('Connected to custom IMAP server');
              engine.receivers.email.watchMailbox('INBOX', (numNewMsgs, email) => {
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
            })
            .catch((error) => {
              console.error('Error connecting to custom IMAP server:', error);
            });
        } else {
          // For built-in email, we'll still use the remote setup
          engine.receivers.email = new EventEmitter();
          engine.receivers.email.on('email', (emailData) => {
            engine.processWorkflowTrigger(emailData);
          });
        }
      },
      validate: (triggerData) => 'subject' in triggerData && 'from' in triggerData,
      process: (inputData) => ({
        from: inputData.from,
        to: inputData.to,
        subject: inputData.subject,
        body: inputData.body,
        html: inputData.html,
        attachments: inputData.attachments,
      }),
    },
    // DISABLED - Using plugin version (slack-plugin)
    // 'receive-slack-message': {
    //   setup: async (engine) => {
    //     engine.receivers.slack = SlackReceiver();
    //     await engine.receivers.slack.initialize(engine.userId);
    //     const slackTriggerNode = engine.workflow.nodes.find((node) => node.type === 'receive-slack-message');
    //     if (slackTriggerNode && slackTriggerNode.parameters && slackTriggerNode.parameters.channelId) {
    //       await engine.receivers.slack.subscribeToChannel(slackTriggerNode.parameters.channelId, (messageData) => {
    //         engine.processWorkflowTrigger(messageData);
    //       });
    //     } else {
    //       throw new Error('Slack trigger node is missing channelId parameter');
    //     }
    //   },
    //   validate: (triggerData) => 'text' in triggerData && 'user' in triggerData,
    //   process: async (inputData, engine) => {
    //     const token = await AuthManager.getValidAccessToken(engine.userId, 'slack');
    //     const slackReceiver = SlackReceiver();
    //     const imageData = await slackReceiver.getImageData(inputData, token);
    //
    //     return {
    //       ...inputData,
    //       timestamp: inputData.ts,
    //       image: imageData,
    //       response: { ...inputData },
    //     };
    //   },
    // },
    // 'google-sheets-new-row': {
    //   setup: async (engine, node) => {
    //     if (!node.parameters || !node.parameters.spreadsheetId || !node.parameters.sheetName) {
    //       throw new Error('Google Sheets trigger node is missing required parameters');
    //     }

    //     engine.receivers.sheets = new SheetsReceiver(
    //       {
    //         spreadsheetId: node.parameters.spreadsheetId,
    //         sheetName: node.parameters.sheetName,
    //       },
    //       engine
    //     );

    //     engine.receivers.sheets.on('newRow', (data) => {
    //       engine.processWorkflowTrigger(data);
    //     });

    //     await engine.receivers.sheets.start();
    //   },
    //   validate: (triggerData) => 'newRow' in triggerData,
    //   process: (inputData) => ({
    //     newRow: inputData.newRow,
    //   }),
    // },
    'trigger-timer': {
      setup: async (engine, node) => {
        if (!node.parameters) {
          throw new Error('Timer trigger node is missing parameters');
        }

        const { fireOnStart, scheduleType, schedule, specificTime, specificDays } = node.parameters;

        const parseSchedule = (scheduleType, schedule, specificTime, specificDays) => {
          const now = new Date();
          if (scheduleType === 'Interval') {
            switch (schedule) {
              case 'Every Minute':
                return 60 * 1000;
              case 'Every 5 Minutes':
                return 5 * 60 * 1000;
              case 'Every 15 Minutes':
                return 15 * 60 * 1000;
              case 'Every 30 Minutes':
                return 30 * 60 * 1000;
              case 'Hourly':
                return 60 * 60 * 1000;
              case 'Daily':
                return 24 * 60 * 60 * 1000;
              case 'Weekly':
                return 7 * 24 * 60 * 60 * 1000;
              case 'Monthly': {
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                return Math.min(nextMonth.getTime() - now.getTime(), 2147483647);
              }
              default:
                throw new Error(`Invalid schedule: ${schedule}`);
            }
          } else if (scheduleType === 'Specific Time') {
            return calculateNextSpecificTime(specificTime, specificDays);
          }
          throw new Error(`Invalid scheduleType: ${scheduleType}`);
        };

        const scheduleNextRun = () => {
          const intervalMs = parseSchedule(scheduleType, schedule, specificTime, specificDays);
          const timerId = setTimeout(() => {
            engine.processWorkflowTrigger({
              type: 'timer',
              nodeId: node.id,
              timestamp: new Date().toISOString(),
            });
            scheduleNextRun(); // Schedule the next run
          }, intervalMs);

          engine.timerIntervals.set(node.id, timerId);
        };

        // Check if fireOnStart is "Yes" and trigger immediately if so
        if (fireOnStart === 'Yes') {
          engine.processWorkflowTrigger({
            type: 'timer',
            nodeId: node.id,
            timestamp: new Date().toISOString(),
          });
        }

        scheduleNextRun();

        console.log(
          `Timer trigger set up for node ${node.id} with scheduleType: ${scheduleType}, schedule: ${schedule}, fireOnStart: ${fireOnStart}`,
        );
      },
      validate: (triggerData, node) => triggerData.type === 'timer' && triggerData.nodeId === node.id,
      process: (inputData) => ({
        timestamp: inputData.timestamp,
      }),
    },
    'webhook-listener': {
      setup: async (engine, node) => {
        try {
          const { method, authType, authToken, username, password } = node.parameters;
          const webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(
            engine.workflowId,
            engine.userId,
            method,
            authType,
            authToken,
            username,
            password,
          );
          console.log(`Webhook registered for workflow ${engine.workflowId}: ${webhookUrl}`);
        } catch (error) {
          console.error(`Error setting up webhook listener: ${error.message}`);
          engine._updateNodeError(node.id, error.message);
          await engine._updateWorkflowStatus('error');
          engine.emit('workflowError', {
            globalError: error.message,
            nodeErrors: engine.errors,
          });
        }
      },
      validate: (triggerData) => triggerData.type === 'webhook',
      process: (inputData) => ({
        method: inputData.method,
        headers: inputData.headers,
        body: inputData.body,
        query: inputData.query,
        params: inputData.params,
      }),
    },
    // 'zapier-trigger': {
    //   setup: async (engine, node) => {
    //     try {
    //       const { authType, authToken, username, password } = node.parameters;
    //       const webhookUrl = ProcessManager.WebhookReceiver.registerWebhook(
    //         engine.workflowId,
    //         engine.userId,
    //         'POST', // Zapier always uses POST
    //         authType,
    //         authToken,
    //         username,
    //         password
    //       );
    //       console.log(`Zapier webhook registered for workflow ${engine.workflowId}: ${webhookUrl}`);
    //     } catch (error) {
    //       console.error(`Error setting up Zapier trigger: ${error.message}`);
    //       engine._updateNodeError(node.id, error.message);
    //       await engine._updateWorkflowStatus('error');
    //       engine.emit('workflowError', {
    //         globalError: error.message,
    //         nodeErrors: engine.errors,
    //       });
    //     }
    //   },
    //   validate: (triggerData) => triggerData.type === 'webhook',
    //   process: (inputData) => {
    //     // Just like a normal HTTP request: method, headers, body, query, params
    //     return {
    //       method: inputData.method,
    //       headers: inputData.headers,
    //       body: inputData.body,
    //       query: inputData.query,
    //       params: inputData.params,
    //     };
    //   },
    // },
    // DISABLED - Using plugin version (discord-plugin)
    // 'receive-discord-message': {
    //   setup: async (engine, node) => {
    //     if (!node.parameters || !node.parameters.channelId) {
    //       throw new Error('Discord trigger node is missing required parameters');
    //     }
    //
    //     engine.receivers.discord = new DiscordReceiver();
    //     await engine.receivers.discord.initialize(engine.userId);
    //
    //     await engine.receivers.discord.subscribeToChannel(node.parameters.channelId, (messageData) => {
    //       engine.processWorkflowTrigger(messageData);
    //     });
    //   },
    //   validate: (triggerData) => 'content' in triggerData && 'author' in triggerData,
    //   process: (inputData) => ({
    //     content: inputData.content,
    //     author: inputData.author,
    //     authorId: inputData.authorId,
    //     channelId: inputData.channelId,
    //     guildId: inputData.guildId,
    //     timestamp: inputData.timestamp,
    //     response: inputData,
    //   }),
    // },
    'run-workflow': {
      execute: async (params, inputData, workflowEngine) => {
        const { workflowId, inputData: subWorkflowInputData, waitForCompletion } = params;

        try {
          // Fetch the sub-workflow
          const subWorkflow = await WorkflowModel.findById(workflowId);
          if (!subWorkflow) {
            throw new Error(`Workflow with ID ${workflowId} not found`);
          }

          // Create a new WorkflowEngine instance for the sub-workflow
          const subWorkflowEngine = new WorkflowEngine(subWorkflow, workflowId, workflowEngine.userId);

          // Merge inputData from the parent workflow with the specified subWorkflowInputData
          let mergedInputData;
          try {
            const parsedSubWorkflowInputData = JSON.parse(subWorkflowInputData);
            mergedInputData = { ...inputData, ...parsedSubWorkflowInputData };
          } catch (parseError) {
            console.warn(`Failed to parse subWorkflowInputData: ${parseError.message}`);
            mergedInputData = inputData;
          }

          console.log('Sub-workflow input data:', mergedInputData);

          if (waitForCompletion) {
            // Execute the sub-workflow synchronously
            const result = await subWorkflowEngine.processWorkflowTrigger(mergedInputData);

            // Stop the sub-workflow engine
            await subWorkflowEngine.stopWorkflowListeners();

            return { success: true, result };
          } else {
            // Execute the sub-workflow asynchronously
            subWorkflowEngine.processWorkflowTrigger(mergedInputData).then(async () => {
              // Stop the sub-workflow engine after it completes
              await subWorkflowEngine.stopWorkflowListeners();
            });

            return {
              success: true,
              result: { message: 'Sub-workflow execution started' },
            };
          }
        } catch (error) {
          console.error(`Error executing sub-workflow: ${error.message}`);
          return { success: false, error: error.message };
        }
      },
    },
  },
};
