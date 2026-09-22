import BaseAction from '../BaseAction.js';
import { runJob, summarizeJob } from '../../../services/agntSandbox.js';
import { serviceFailure } from '../../../services/agntServices.js';

/**
 * Run a command in a fresh, isolated VM on sandbox.agnt.gg. Included with AGNT Pro.
 */
class RunSandbox extends BaseAction {
  static schema = {
    title: 'Run in Sandbox',
    category: 'action',
    type: 'run-sandbox',
    icon: 'terminal',
    description:
      'Runs a shell command in a fresh isolated VM (Python 3 and Node available), returns its output and any exported files, then destroys the VM. Included with AGNT Pro.',
    parameters: {
      command: {
        type: 'string',
        inputType: 'textarea',
        description: 'The shell command to run, e.g. "python3 script.py > out.txt"',
      },
      inputs: {
        type: 'array',
        inputType: 'textarea',
        description: 'Optional files to place in the VM before running: JSON array of { "path": "script.py", "content": "..." } (up to 8, 8 MB total)',
      },
      outputs: {
        type: 'array',
        inputType: 'textarea',
        description: 'Optional files to export when the command finishes: JSON array of relative paths, e.g. ["out.txt"]',
      },
      lifetimeSeconds: {
        type: 'number',
        inputType: 'text',
        description: 'Maximum seconds for the whole job including boot and export (10-900, default 120)',
        default: 120,
      },
      size: {
        type: 'string',
        inputType: 'select',
        options: ['small', 'medium', 'large'],
        description: 'VM size. Small counts 1 compute-minute per minute, medium 2, large 4.',
        default: 'small',
      },
    },
    outputs: {
      success: { type: 'boolean', description: 'True when the command exited 0' },
      exitCode: { type: 'number', description: 'Exit code of the command' },
      output: { type: 'string', description: 'Combined stdout and stderr' },
      artifacts: { type: 'array', description: 'Exported files: id, path, bytes, expiresAt' },
      jobId: { type: 'string', description: 'The sandbox job id' },
      error: { type: 'string', description: 'Error message if the job failed' },
    },
  };

  constructor() {
    super('runSandbox');
  }

  async execute(params) {
    this.validateParams(params);
    const parse = (v) => { if (Array.isArray(v)) return v; if (typeof v === 'string' && v.trim()) { try { return JSON.parse(v); } catch { return []; } } return []; };
    try {
      const job = await runJob({
        command: params.command,
        inputs: parse(params.inputs),
        outputs: parse(params.outputs),
        lifetimeSeconds: params.lifetimeSeconds,
        size: params.size,
      });
      return this.formatOutput(summarizeJob(job));
    } catch (error) {
      const failure = serviceFailure(error);
      return this.formatOutput({ success: false, exitCode: null, output: '', artifacts: [], jobId: null, error: failure.message || failure.error, ...failure });
    }
  }
}

export default new RunSandbox();
