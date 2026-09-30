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

/** The Python to hand the harness in place of the raw step. */
export function wrapBrowserScript(source) {
  const encoded = Buffer.from(String(source ?? ''), 'utf8').toString('base64');
  return `${PRELUDE}\n_bh_run(_bh_base64.b64decode("${encoded}").decode("utf-8"))\n`;
}

export default wrapBrowserScript;
