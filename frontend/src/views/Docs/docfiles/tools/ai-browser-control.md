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

**Only a browser AGNT is rendering** — the Browser widget on the workspace canvas. Calling the tool in chat opens that widget if it is not already there.

If no widget is open, the tool **fails with an instruction rather than falling back**. This is deliberate. The underlying `browser-use` CLI, left to itself, looks for any Chrome with remote debugging enabled and attaches to it — which would be *your* browser, with *your* logged-in sessions. AGNT never does that.

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

1. **`new_tab()` is not available.** The Browser widget hosts a single tab, so `Target.createTarget` is refused. Navigate with `goto_url(url)` instead.
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
| `error` | Why the step could not be run |

## Environment

Shares one pinned Python environment with the Browser Agent — the `browser-use` CLI ships in the same wheel as the library, so there is nothing extra to install. The pin lives in `browserUseEnvironment.js`; bumping that constant is the whole upgrade procedure for both tools.
