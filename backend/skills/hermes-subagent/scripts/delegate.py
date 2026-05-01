"""
delegate.py — Annie's canonical Hermes sub-agent invocation.

Wraps Nous Research's hermes-agent (run_agent.AIAgent) with the verified-working
defaults from the hermes-subagent skill. Loads the sandbox .env, calls Hermes
once, and prints the result on stdout.

Usage (from Windows shell):
    "C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\hermes-sandbox\\.venv\\Scripts\\python.exe" ^
      "C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\skills\\hermes-subagent\\scripts\\delegate.py" ^
      "your task here"

Optional flags:
    --model            OpenRouter model id (default anthropic/claude-sonnet-4.5)
    --provider         provider name (default openrouter)
    --max-tokens       cap on output tokens to avoid HTTP 402 (default 4000)
    --max-iterations   max Hermes agent loop iterations (default 30)
    --session-id       reuse a Hermes session for multi-turn continuity
    --toolsets         comma-separated list of enabled_toolsets
    --disabled         comma-separated list of disabled_toolsets
    --verbose          print Hermes' status messages too (default quiet)

Exit codes:
    0   success — Hermes returned a non-empty response
    2   Hermes returned None or an empty string (model resolution issue)
    3   .env missing or unreadable
    4   import failure — sandbox venv is broken
    5   API error from upstream provider (e.g. 402, 401)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

SANDBOX_DIR = Path(r"C:\Users\Studio\AppData\Roaming\AGNT\hermes-sandbox")
ENV_PATH = SANDBOX_DIR / ".env"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delegate a task to Hermes Agent as an AGNT sub-agent."
    )
    parser.add_argument("prompt", help="The task to delegate to Hermes.")
    parser.add_argument("--model", default="anthropic/claude-sonnet-4.5")
    parser.add_argument("--provider", default="openrouter")
    parser.add_argument("--max-tokens", type=int, default=4000)
    parser.add_argument("--max-iterations", type=int, default=30)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--toolsets", default=None,
                        help="Comma-separated enabled_toolsets list.")
    parser.add_argument("--disabled", default=None,
                        help="Comma-separated disabled_toolsets list.")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def load_env() -> None:
    if not ENV_PATH.exists():
        print(
            f"[delegate.py] sandbox .env not found at {ENV_PATH}. "
            "Add OPENROUTER_API_KEY=... to that file before delegating.",
            file=sys.stderr,
        )
        sys.exit(3)

    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        print(
            "[delegate.py] python-dotenv not installed in sandbox venv. "
            "Reinstall hermes-agent.",
            file=sys.stderr,
        )
        sys.exit(4)

    load_dotenv(ENV_PATH)

    if not os.environ.get("OPENROUTER_API_KEY") and \
       not os.environ.get("ANTHROPIC_API_KEY") and \
       not os.environ.get("OPENAI_API_KEY"):
        print(
            "[delegate.py] no LLM API key found in environment after loading "
            f"{ENV_PATH}. Add OPENROUTER_API_KEY=... to that file.",
            file=sys.stderr,
        )
        sys.exit(3)


def import_hermes():
    try:
        from run_agent import AIAgent  # type: ignore
    except ImportError as e:
        print(
            f"[delegate.py] cannot import run_agent.AIAgent from sandbox venv: {e}\n"
            "Reinstall hermes-agent into the sandbox venv.",
            file=sys.stderr,
        )
        sys.exit(4)
    return AIAgent


def main() -> int:
    args = parse_args()
    load_env()
    AIAgent = import_hermes()

    enabled_toolsets = (
        [t.strip() for t in args.toolsets.split(",") if t.strip()]
        if args.toolsets
        else None
    )
    disabled_toolsets = (
        [t.strip() for t in args.disabled.split(",") if t.strip()]
        if args.disabled
        else None
    )

    agent_kwargs = dict(
        quiet_mode=not args.verbose,
        model=args.model,
        provider=args.provider,
        max_tokens=args.max_tokens,
        max_iterations=args.max_iterations,
    )
    if enabled_toolsets is not None:
        agent_kwargs["enabled_toolsets"] = enabled_toolsets
    if disabled_toolsets is not None:
        agent_kwargs["disabled_toolsets"] = disabled_toolsets
    if args.session_id:
        agent_kwargs["session_id"] = args.session_id

    started = time.time()
    try:
        agent = AIAgent(**agent_kwargs)
        response = agent.chat(args.prompt)
    except Exception as e:
        msg = str(e)
        print(f"[delegate.py] Hermes call failed: {msg}", file=sys.stderr)
        # try to surface useful error code
        if "402" in msg or "credits" in msg.lower():
            return 5
        if "401" in msg or "auth" in msg.lower():
            return 5
        return 1

    duration = time.time() - started

    if response is None or (isinstance(response, str) and not response.strip()):
        print(
            "[delegate.py] Hermes returned an empty response. "
            "Most often this means the model wasn't resolved — "
            "verify --model and --provider are valid.",
            file=sys.stderr,
        )
        return 2

    print(response)
    print(
        f"\n[delegate.py] model={args.model} provider={args.provider} "
        f"max_tokens={args.max_tokens} duration={duration:.1f}s",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
