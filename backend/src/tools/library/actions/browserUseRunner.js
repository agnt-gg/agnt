/**
 * The Python program the Browser Agent runs, and the contract it speaks.
 *
 * It is a constant rather than a .py file on disk because the backend is
 * packaged into an asar archive, where `fs.readFileSync(import.meta.url/..)`
 * stops working; the tool writes this to the user-data directory at run time.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: no caller data is ever formatted
 * into the program. The predecessor built its Python by string-concatenating
 * the user's instructions into a `python -c` payload, with `"` escaped inside a
 * `"""` literal — which does not even close the hole, since the instructions
 * are workflow-controlled text arriving from Discord, email or a webhook.
 * Here the program is a fixed, hashable constant and everything variable
 * arrives as JSON on stdin. There is no concatenation to get wrong.
 *
 * stdin  : one JSON object, the RunnerConfig documented below.
 * stdout : browser-use's own logging, plus exactly one result line prefixed
 *          with RESULT_SENTINEL. The caller reads the LAST such line.
 * exit   : 0 when the runner completed its protocol (even if the agent failed
 *          its task — that is reported in the result, not the exit code),
 *          non-zero only when it could not.
 */

export const RESULT_SENTINEL = '__AGNT_BROWSER_USE_RESULT__';

/**
 * Bump when RUNNER_PY changes in a way the JS side must notice. The runner is
 * rewritten to disk whenever this differs from the cached copy, so a stale file
 * from a previous version can never be executed against a new contract.
 */
export const RUNNER_VERSION = 2;

// NOTE: this is a String.raw template literal, so the Python below may not
// contain a backtick or a ${ sequence. Use quotes in Python messages.
export const RUNNER_PY = String.raw`
"""AGNT Browser Agent runner. Generated from browserUseRunner.js — do not edit
this copy; edits are overwritten whenever the tool's runner version changes."""

import asyncio
import json
import os
import sys
import traceback
from typing import Any, Literal, Optional, Union

RESULT_SENTINEL = "__AGNT_BROWSER_USE_RESULT__"


def emit(payload: dict) -> None:
    """Write the one machine-readable line this process exists to produce."""
    sys.stdout.write("\n" + RESULT_SENTINEL + " " + json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


# ─────────────────────────── JSON Schema → Pydantic ───────────────────────────
# browser-use's output_model_schema wants a Pydantic class, but a workflow node
# can only hand us JSON. This converts the subset that real extraction schemas
# use, and REFUSES anything else by name. A schema that silently lost half its
# fields would produce confidently wrong extractions, which is worse than a
# task that will not start.

_PRIMITIVES = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _resolve_ref(ref: str, root: dict) -> dict:
    if not ref.startswith("#/"):
        raise ValueError(
            "outputSchema uses an external $ref (" + ref + "). "
            "Only local refs into $defs/definitions are supported."
        )
    node: Any = root
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise ValueError("outputSchema $ref " + ref + " does not resolve.")
        node = node[part]
    return node


def _python_type(schema: dict, root: dict, name: str):
    if "$ref" in schema:
        return _python_type(_resolve_ref(schema["$ref"], root), root, name)

    if "enum" in schema:
        return Literal[tuple(schema["enum"])]  # type: ignore[misc]

    any_of = schema.get("anyOf") or schema.get("oneOf")
    if any_of:
        non_null = [s for s in any_of if s.get("type") != "null"]
        if len(non_null) == 1:
            return Optional[_python_type(non_null[0], root, name)]
        return Optional[Union[tuple(_python_type(s, root, name) for s in non_null)]]  # type: ignore[misc]

    schema_type = schema.get("type")

    if isinstance(schema_type, list):
        non_null = [t for t in schema_type if t != "null"]
        if len(non_null) != 1:
            raise ValueError("outputSchema field '" + name + "' has an unsupported union type.")
        return Optional[_python_type({**schema, "type": non_null[0]}, root, name)]

    if schema_type in _PRIMITIVES:
        return _PRIMITIVES[schema_type]

    if schema_type == "array":
        items = schema.get("items")
        if not items:
            raise ValueError("outputSchema array '" + name + "' must declare an 'items' type.")
        return list[_python_type(items, root, name + "Item")]  # type: ignore[misc]

    if schema_type == "object":
        return _model_from_schema(schema, root, name.title().replace("_", "") + "Model")

    raise ValueError(
        "outputSchema field '" + name + "' has unsupported type " + repr(schema_type) + "."
    )


def _model_from_schema(schema: dict, root: dict, model_name: str):
    from pydantic import create_model

    properties = schema.get("properties")
    if not properties:
        raise ValueError("outputSchema object '" + model_name + "' must declare 'properties'.")

    required = set(schema.get("required") or [])
    fields: dict[str, Any] = {}
    for field_name, field_schema in properties.items():
        annotation = _python_type(field_schema, root, field_name)
        if field_name in required:
            fields[field_name] = (annotation, ...)
        else:
            fields[field_name] = (Optional[annotation], None)

    return create_model(model_name, **fields)


def build_output_model(schema: dict):
    return _model_from_schema(schema, schema, schema.get("title") or "AgentOutputModel")


# ─────────────────────────────── LLM construction ─────────────────────────────
# Data, not code. The JS side names a class that browser-use exports and the
# keyword arguments to build it with; nothing here branches on provider.


def build_llm(spec: Optional[dict]):
    if not spec:
        return None

    import browser_use.llm as llm_module

    class_name = spec["class"]
    chat_class = getattr(llm_module, class_name, None)
    if chat_class is None:
        available = ", ".join(sorted(n for n in dir(llm_module) if n.startswith("Chat")))
        import importlib.metadata as _md

        raise ValueError(
            "browser-use " + _md.version("browser-use")
            + " has no chat class '" + class_name + "'. Available: " + available
        )
    return chat_class(**spec.get("kwargs", {}))


# ────────────────────────────────── main ──────────────────────────────────────


async def run(config: dict) -> dict:
    from browser_use import Agent, Browser, BrowserProfile

    llm = build_llm(config.get("llm"))
    if llm is None:
        raise ValueError("No llm specification was supplied to the runner.")

    # ATTACH vs LAUNCH. With a cdpUrl we are a GUEST on a browser somebody else
    # owns — today that is the Electron surface rendered inside AGNT's Browser
    # widget. is_local=False tells browser-use not to manage that browser's
    # lifecycle, which is the difference between "the agent finished" and "the
    # agent closed the window the user was watching".
    cdp_url = config.get("cdpUrl")
    attached = bool(cdp_url)
    if attached:
        browser = Browser(cdp_url=cdp_url, is_local=False)
    else:
        profile_kwargs = {k: v for k, v in (config.get("browser") or {}).items() if v is not None}
        browser = Browser(browser_profile=BrowserProfile(**profile_kwargs)) if profile_kwargs else Browser()

    agent_kwargs: dict[str, Any] = dict(config.get("agent") or {})
    agent_kwargs = {k: v for k, v in agent_kwargs.items() if v is not None}

    output_schema = config.get("outputSchema")
    if output_schema:
        agent_kwargs["output_model_schema"] = build_output_model(output_schema)

    page_extraction_llm = build_llm(config.get("pageExtractionLlm"))
    if page_extraction_llm is not None:
        agent_kwargs["page_extraction_llm"] = page_extraction_llm

    fallback_llm = build_llm(config.get("fallbackLlm"))
    if fallback_llm is not None:
        agent_kwargs["fallback_llm"] = fallback_llm

    if config.get("sensitiveData"):
        agent_kwargs["sensitive_data"] = config["sensitiveData"]
    if config.get("initialActions"):
        agent_kwargs["initial_actions"] = config["initialActions"]

    agent = Agent(task=config["task"], llm=llm, browser=browser, **agent_kwargs)

    try:
        history = await agent.run(max_steps=int(config.get("maxSteps") or 100))
    finally:
        if attached:
            # Detach only. kill() here would close the browser AGNT is rendering
            # — the user would watch their own window disappear the moment the
            # task finished.
            try:
                await browser.stop()
            except Exception:
                pass
        else:
            # We launched it, so we own it. A leaked Chromium survives the
            # workflow and there is nothing left holding a handle to it.
            try:
                await browser.kill()
            except Exception:
                try:
                    await browser.stop()
                except Exception:
                    pass

    structured = None
    try:
        if output_schema and history.structured_output is not None:
            structured = history.structured_output.model_dump()
    except Exception:
        structured = None

    return {
        "success": True,
        "isDone": bool(history.is_done()),
        "isSuccessful": history.is_successful(),
        "finalResult": history.final_result(),
        "structuredOutput": structured,
        "extractedContent": history.extracted_content(),
        "urls": [u for u in history.urls() if u],
        "actionNames": history.action_names(),
        "errors": [e for e in history.errors() if e],
        "steps": history.number_of_steps(),
        "durationSeconds": history.total_duration_seconds(),
    }


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        emit({"success": False, "error": "Runner received no configuration on stdin."})
        return 2

    try:
        config = json.loads(raw)
    except Exception as exc:
        emit({"success": False, "error": "Runner could not parse its stdin config: " + str(exc)})
        return 2

    try:
        emit(asyncio.run(run(config)))
        return 0
    except Exception as exc:
        emit({
            "success": False,
            "error": str(exc) or exc.__class__.__name__,
            "errorType": exc.__class__.__name__,
            "traceback": traceback.format_exc(),
        })
        # The protocol was honoured — the caller has a structured error to show.
        # Exiting non-zero as well would make it choose between two stories.
        return 0


if __name__ == "__main__":
    sys.exit(main())
`;
