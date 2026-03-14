#!/usr/bin/env python3
"""
Formats claude CLI stream-json output into readable, colored terminal output.

Usage: claude -p --output-format stream-json ... | python3 ralph_stream_filter.py
"""
import os
import socket
import sys
import json
import signal

signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
signal.signal(signal.SIGPIPE, signal.SIG_DFL)

# Optional narration socket forwarding
NARRATE_SOCKET = os.environ.get("RALPH_NARRATE_SOCKET", "")
TASK_CONTEXT = os.environ.get("RALPH_TASK_CONTEXT", "")


def send_to_narrate(text):
    """Forward text to the narration server (async, non-blocking, best-effort)."""
    if not NARRATE_SOCKET or not text.strip():
        return
    try:
        if not os.path.exists(NARRATE_SOCKET):
            return
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(NARRATE_SOCKET)
        s.sendall(text.encode("utf-8"))
        s.close()
    except (OSError, socket.error):
        pass

# ANSI colors
CYAN = "\033[36m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
RESET = "\033[0m"


def fmt_tool(block):
    """Format a tool_use content block into a one-line summary."""
    name = block.get("name", "?")
    inp = block.get("input", {})

    if name == "Read":
        path = inp.get("file_path", "")
        return f"{CYAN}Read{RESET} {DIM}{short_path(path)}{RESET}"
    elif name == "Edit":
        path = inp.get("file_path", "")
        return f"{CYAN}Edit{RESET} {DIM}{short_path(path)}{RESET}"
    elif name == "Write":
        path = inp.get("file_path", "")
        return f"{CYAN}Write{RESET} {DIM}{short_path(path)}{RESET}"
    elif name == "Bash":
        cmd = inp.get("command", "")
        desc = inp.get("description", "")
        label = desc if desc else (cmd[:60] + "..." if len(cmd) > 60 else cmd)
        return f"{CYAN}Bash{RESET} {DIM}{label}{RESET}"
    elif name == "Glob":
        return f"{CYAN}Glob{RESET} {DIM}{inp.get('pattern', '')}{RESET}"
    elif name == "Grep":
        pat = inp.get("pattern", "")
        path = inp.get("path", "")
        suffix = f" in {short_path(path)}" if path else ""
        return f"{CYAN}Grep{RESET} {DIM}{pat}{suffix}{RESET}"
    elif name == "Task":
        desc = inp.get("description", "subagent")
        return f"{CYAN}Task{RESET} {DIM}{desc}{RESET}"
    else:
        return f"{CYAN}{name}{RESET}"


def short_path(path):
    """Shorten an absolute path to the last 3 components."""
    parts = path.split("/")
    if len(parts) > 3:
        return ".../" + "/".join(parts[-3:])
    return path


def fmt_result(event):
    """Format the final result summary."""
    dur = event.get("duration_ms", 0) / 1000
    cost = event.get("total_cost_usd", 0)
    turns = event.get("num_turns", 0)
    is_error = event.get("is_error", False)

    if is_error:
        errors = event.get("errors", [])
        err_msg = errors[0] if errors else "unknown error"
        return f"{RED}FAILED{RESET} {DIM}{dur:.0f}s | {turns} turns | ${cost:.4f}{RESET} -- {err_msg}"
    else:
        return f"{GREEN}Done{RESET} {DIM}{dur:.0f}s | {turns} turns | ${cost:.4f}{RESET}"


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        # Not JSON -- pass through as-is (might be stderr or plain text)
        print(line, flush=True)
        continue

    t = e.get("type", "")

    if t == "system" and e.get("subtype") == "init":
        model = e.get("model", "?")
        mode = e.get("permissionMode", "?")
        print(f"  {DIM}[init]{RESET} {model} | {mode}", flush=True)

    elif t == "assistant":
        content = e.get("message", {}).get("content", [])
        for block in content:
            bt = block.get("type", "")
            if bt == "tool_use":
                print(f"  > {fmt_tool(block)}", flush=True)
                # Forward tool use to narration server
                narrate_payload = {
                    "tool": block.get("name", ""),
                    "input": json.dumps(block.get("input", {}))[:500],
                }
                if TASK_CONTEXT:
                    narrate_payload["task"] = TASK_CONTEXT
                send_to_narrate(json.dumps(narrate_payload))
            elif bt == "text":
                text = block.get("text", "").strip()
                if text:
                    # Show first line only, truncated
                    first_line = text.split("\n")[0]
                    if len(first_line) > 80:
                        first_line = first_line[:77] + "..."
                    print(f"  {YELLOW}{first_line}{RESET}", flush=True)
                    # Forward assistant text to narration server
                    if TASK_CONTEXT:
                        send_to_narrate(f"[Task: {TASK_CONTEXT}]\n{text[:1000]}")
                    else:
                        send_to_narrate(text[:1000])

    elif t == "result":
        print(f"  {fmt_result(e)}", flush=True)
