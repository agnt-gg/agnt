/**
 * Make the Python a model writes for action="script" actually run.
 *
 * browser-harness executes a step with a bare `exec(code, globals())`, and its
 * helpers are SYNCHRONOUS (goto_url, js, capture_screenshot, ...). Models
 * routinely write two things against that:
 *
 *   1. `await` — every other browser-automation API they know (Playwright,
 *      Puppeteer, CDP libraries) is async, so `await navigate(url)` is the
 *      default shape. A top-level await is a SyntaxError under exec(), and the
 *      whole step fails before a single line runs.
 *   2. Names from those APIs — navigate, evaluate, screenshot — which do not
 *      exist here. (Our own tool description even advertised `screenshot`.)
 *
 * The step is therefore wrapped, not passed through:
 *
 *   - Every `await X` becomes `await _bh_resolve(X)`, which awaits X only if it
 *     is awaitable. So awaiting a synchronous helper works, awaiting
 *     asyncio.sleep works, and `async def` in the script works. The module is
 *     compiled with PyCF_ALLOW_TOP_LEVEL_AWAIT and, when it contains an await,
 *     run with asyncio.run — the same mechanism as Python's asyncio REPL.
 *   - navigate/evaluate/screenshot (and a few close relatives) are defined in
 *     terms of the real helpers, unless the script or harness already defines
 *     the name.
 *   - The source travels base64-encoded, so no quote, backslash or unicode in
 *     it can break out of the wrapper, and it is registered with linecache as
 *     "<script>" so a traceback shows the model's own line and text.
 *
 * Plain synchronous scripts behave exactly as before.
 */

const PRELUDE = String.raw`
import ast as _bh_ast, asyncio, base64 as _bh_base64, inspect as _bh_inspect, linecache as _bh_linecache, time
import sys as _bh_sys, traceback as _bh_traceback

# Python 3.12 and older print an uncaught error in C, which reads source only
# from files on disk, so the script's "<script>" frames showed no text. The
# traceback module reads linecache, where _bh_run registers the script. This
# replaces only the built-in printer and Ubuntu's apport hook (installed in
# every system Python, it prints through the same C path); a harness's own
# handler stays.
if (_bh_sys.excepthook is _bh_sys.__excepthook__
        or getattr(_bh_sys.excepthook, "__module__", None) == "apport_python_hook"):
    _bh_sys.excepthook = _bh_traceback.print_exception

async def _bh_resolve(value):
    return (await value) if _bh_inspect.isawaitable(value) else value

class _BhAwaitShim(_bh_ast.NodeTransformer):
    def visit_Await(self, node):
        self.generic_visit(node)
        call = _bh_ast.Call(func=_bh_ast.Name(id="_bh_resolve", ctx=_bh_ast.Load()), args=[node.value], keywords=[])
        return _bh_ast.copy_location(_bh_ast.Await(value=call), node)

def _bh_define_aliases():
    g = globals()
    def navigate(url, wait=True, timeout=15.0):
        result = g["goto_url"](url)
        if wait and "wait_for_load" in g:
            g["wait_for_load"](timeout)
        return result
    def evaluate(expression, *args, **kwargs):
        return g["js"](expression, *args, **kwargs)
    def screenshot(path=None, full=False, max_dim=None, full_page=None):
        # With a path: save there and return the path. Without one: return the
        # PNG bytes, which is what Playwright-style code expects to receive.
        if full_page is not None:
            full = full_page
        if path:
            return g["capture_screenshot"](path, full=full, max_dim=max_dim)
        saved = g["capture_screenshot"](None, full=full, max_dim=max_dim)
        with open(saved, "rb") as handle:
            return handle.read()
    aliases = {
        "navigate": navigate, "goto": navigate, "open_url": navigate,
        "evaluate": evaluate, "execute_script": evaluate, "eval_js": evaluate,
        "screenshot": screenshot, "take_screenshot": screenshot,
    }
    for name, fn in aliases.items():
        if name not in g:
            g[name] = fn

def _bh_run(source):
    _bh_linecache.cache["<script>"] = (len(source), None, source.splitlines(True), "<script>")
    tree = _bh_ast.parse(source, filename="<script>", mode="exec")
    tree = _bh_ast.fix_missing_locations(_BhAwaitShim().visit(tree))
    code = compile(tree, "<script>", "exec", flags=_bh_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    if code.co_flags & _bh_inspect.CO_COROUTINE:
        asyncio.run(eval(code, globals()))
    else:
        exec(code, globals())

_bh_define_aliases()
`;

/**
 * The line a pinned step prints last: the tab it ENDED on, so the live card
 * can follow a script that opened or switched tabs. Stripped from the output
 * before the model sees it (readFinalTab).
 */
export const FINAL_TAB_MARKER = '__AGNT_TAB__';

/** Target ids are hex; anything else is not something to interpolate into Python. */
const TARGET_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The Python to hand the harness in place of the raw step.
 *
 * WHY A STEP CAN BE PINNED TO A TAB. The harness daemon is one process for the
 * whole browser and remembers ONE current tab across steps. Every
 * conversation's script ran on whatever tab the last script — any
 * conversation's — left it on, which is how one chat's script drove another
 * chat's page. With `startTab` the step first attaches to the conversation's
 * own tab, and reports the tab it ended on.
 *
 * @param {string} source
 * @param {{ startTab?: string|null }} [options]
 */
export function wrapBrowserScript(source, { startTab = null } = {}) {
  const encoded = Buffer.from(String(source ?? ''), 'utf8').toString('base64');
  const run = `_bh_run(_bh_base64.b64decode("${encoded}").decode("utf-8"))`;
  if (!startTab) return `${PRELUDE}\n${run}\n`;
  if (!TARGET_ID.test(String(startTab))) throw new Error(`Refusing to pin a script to a malformed tab id: ${String(startTab).slice(0, 40)}`);
  return `${PRELUDE}
try:
    switch_tab("${startTab}")
except Exception as _bh_pin_error:
    raise RuntimeError("Could not start on this conversation's browser tab: %s" % _bh_pin_error)
try:
    ${run}
finally:
    try:
        print("${FINAL_TAB_MARKER}", current_tab()["targetId"], flush=True)
    except Exception:
        pass
`;
}

/**
 * Split a pinned step's output into what the script printed and the tab it
 * ended on. Only the LAST line can be the marker; a script printing the marker
 * text itself elsewhere is just output.
 * @returns {{ output: string, finalTab: string|null }}
 */
export function readFinalTab(stdout) {
  const text = String(stdout ?? '');
  const match = new RegExp(`(?:^|\\r?\\n)${FINAL_TAB_MARKER} ([A-Za-z0-9_-]{1,128})\\s*$`).exec(text);
  if (!match) return { output: text, finalTab: null };
  return { output: text.slice(0, match.index), finalTab: match[1] };
}

export default wrapBrowserScript;
