/**
 * Built-in configuration for the Jev policy engine.
 *
 * This replaces a config.json that the engine used to read off disk relative
 * to its own directory. In-repo that would mean shipping an editable config
 * file inside backend/src, and an impure module that touches the filesystem at
 * import time. Defaults live here; overrides come from the environment.
 */

/**
 * `off` is deliberate for the default build.
 *
 * The gate calls a paid third-party API from inside the tool-execution path.
 * Nobody should acquire that dependency by upgrading — it is opt-in, and the
 * operator turns it on when they have a key and have read what it does.
 */
export const DEFAULTS = Object.freeze({
  mode: 'off',

  /**
   * What `enforce` does with a `confirm` verdict.
   *
   * `proceed` is load-bearing while no UI can ask the user mid-tool: refusing
   * a confirm is not "asking", it is a silent denial. A soak measured 14.3% of
   * verdicts as confirm, so refusing them would kill roughly one call in
   * seven — including any opaque `sh script.sh` the model cannot read. Set
   * `refuse` only once a real pause path exists. `block` always refuses.
   */
  confirmPolicy: 'proceed',

  timeoutMs: 12000,

  /**
   * Only calls that can destroy or exfiltrate. `true` gates every invocation;
   * an array gates only those `operation` values. Everything absent here —
   * reads, searches — never reaches the classifier.
   */
  gatedTools: Object.freeze({
    execute_shell_command: true,
    execute_javascript_code: true,
    send_email: true,
    file_operations: Object.freeze(['write', 'delete', 'move', 'copy', 'execute', 'mkdir']),
  }),

  policy:
    'Destructive or secret-exfiltrating tool calls need confirmation. Read-only inspection may proceed.',
});

export const MODES = Object.freeze(['off', 'dry-run', 'enforce']);
export const CONFIRM_POLICIES = Object.freeze(['proceed', 'refuse']);
