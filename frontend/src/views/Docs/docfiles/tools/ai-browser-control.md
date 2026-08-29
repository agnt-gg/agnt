# Browser Control 🕹️

## Id

`ai-browser-control`

## Description

Lets the assistant drive the AGNT Browser widget **directly**, one step at a time, by running Python in it and reading the result back.

This is the other half of [Browser Agent](#/docs/tools/ai-browser-use). They are not competitors — they answer different questions:

| | Browser Agent (`ai-browser-use`) | Browser Control (`ai-browser-control`) |
|---|---|---|
| Where it runs | Workflows **and** chat | Chat only |
| Who does the thinking | A second AI agent, inside the tool | The assistant you are already talking to |
| You give it | A sentence: *"find the cheapest flight"* | A step: `goto_url(...)`, then read the page |
| Costs a second model | Yes | **No** |
| Can change its mind mid-task | Not without finishing first | Yes, between every step |

Use **Browser Agent** when a whole task should be handed off and completed on its own — especially unattended, in a workflow. Use **Browser Control** when the assistant should look at the page and decide what to do next, or interleave browsing with its other tools.

## Why it is chat-only

Its parameter is a **program**. A workflow node's parameters are templated from trigger data — text arriving from Discord, email or a webhook — so a workflow node that executes Python would let that text become the program. That is the exact hole the Browser Agent's runner was rewritten to close.

So Browser Control is hidden from the workflow palette, and it also refuses a non-chat caller outright. If you need browser automation in a workflow, use the Browser Agent node: it takes plain English and does its own reasoning.

## Which browser it drives

**The Browser widget on the workspace canvas, whenever there is one.** Calling the tool in chat opens that widget if it is not already there, so the work happens next to the conversation where you can watch it.

**If no widget is available, AGNT opens a clean browser of its own** — a dedicated profile under AGNT's data directory, with no cookies, no sessions and no extensions. It is reused across steps, so a page you navigated to in one step is still there in the next, and it closes when AGNT does.

What it will **never** do is drive *your* browser. The underlying `browser-use` CLI, left to itself, looks for any Chrome with remote debugging enabled and attaches to it — which would be your real one, with your logged-in sessions. AGNT does not do that: it either drives its own widget or opens its own browser.

The `surface` output says which one you got: `widget` or `launched`.

Set `AGNT_BROWSER_PATH` to choose which browser gets launched. Chrome, Chromium and Edge are found automatically.

## Writing a step

Helpers are pre-imported. Only what you `print()` comes back.

```python
goto_url("https://news.ycombinator.com")
wait_for_load()
print(page_info())
```

Reading the page:

```python
print(js("document.querySelector('h1').innerText"))

nodes = cdp("Accessibility.getFullAXTree")["nodes"]
links = [n for n in nodes if n.get("role", {}).get("value") == "link"]
print(len(links))
```

Clicking — take the element's `backendDOMNodeId` from the accessibility tree, turn it into a box, click the centre:

```python
q = cdp("DOM.getBoxModel", backendNodeId=node_id)["model"]["content"]
x, y = sum(q[0::2]) / 4, sum(q[1::2]) / 4
click_at_xy(x, y)
```

### Two rules specific to AGNT

1. **Navigate with `goto_url(url)`, not `new_tab(url)`.** The Browser widget hosts a single tab, so `Target.createTarget` is refused there. `goto_url` works on both surfaces, which is why it is the one to reach for.
2. **Always `wait_for_load()` after navigating.** Otherwise a `page_info()` or `js(...)` call races the new document and fails on a half-built page.

## Parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `python` | textarea | — | The step to run. Only `print()` output is returned. |
| `timeoutSeconds` | number | `120` | Hard limit for this one step. Keep steps short and call again. |

## Outputs

| Name | Description |
|---|---|
| `output` | Everything the Python printed |
| `diagnostics` | Warnings the CLI wrote to stderr |
| `url` | The browser surface that was driven |
| `surface` | `widget` for the canvas widget, `launched` for a browser AGNT opened |
| `error` | Why the step could not be run |

## Environment

Shares one pinned Python environment with the Browser Agent — the `browser-use` CLI ships in the same wheel as the library, so there is nothing extra to install. The pin lives in `browserUseEnvironment.js`; bumping that constant is the whole upgrade procedure for both tools.
