#!/usr/bin/env python3
"""
Ralph narration server — listens on a Unix socket, summarizes events via
Claude Haiku, and speaks them aloud using Kokoro TTS.

Uses a single worker thread with debounce so rapid events collapse into
one narration instead of piling up.

Usage:
    python3 ralph_narrate_server.py [--voice VOICE] [--socket PATH]
"""
import os
import queue
import signal
import socket
import sys
import threading
import time

import sounddevice as sd
from kokoro import KPipeline
from anthropic import Anthropic

DEFAULT_SOCKET = "/tmp/ralph-tts.sock"
DEFAULT_VOICE = "bf_emma"
DEBOUNCE_SECONDS = 1.5

COMPANION_PROMPT = """\
You are a sassy programming companion with a dry wit, narrating what's happening in a coding session. \
You receive output from a Claude Code assistant — either a tool use event (JSON with tool name, input, and optionally a "task" field describing the current task) \
or a final assistant message (possibly prefixed with [Task: ...]) — and summarize it as brief, punchy spoken commentary, \
like a slightly sarcastic coworker watching over someone's shoulder.

Rules:
- Keep it to 1-2 short sentences, be succinct
- Sarcasm and dry humor are encouraged — think deadpan, not mean
- Focus on what just happened, editorialize a little — use the task context to make your commentary relevant
- Never read out code, file paths, or terminal output verbatim
- If it's a question to the user, rephrase it with a bit of attitude
- If it's just a small acknowledgment, a quip or a few words is fine
- If a tool action is trivial or routine (like reading a file), say SKIP and nothing else
- No markdown, no formatting, not even asterisks or underscores for emphasis as these will be spoken aloud"""

# Globals set in main()
pipeline = None
client = None
voice = DEFAULT_VOICE

# Single narration queue — new events replace pending ones
narration_queue = queue.Queue()
cancel_event = threading.Event()


def summarize(text):
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        timeout=15,
        system=COMPANION_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    return response.content[0].text


def speak(text):
    cancel_event.clear()
    try:
        # Re-query default output device each time (handles dock/undock, BT changes)
        device = sd.default.device[1]  # output device index
        for _, _, audio in pipeline(text, voice=voice):
            if cancel_event.is_set():
                sd.stop()
                return
            sd.play(audio, samplerate=24000, device=device)
            while sd.get_stream().active:
                if cancel_event.is_set():
                    sd.stop()
                    return
                sd.wait()
    except sd.PortAudioError:
        # Audio device changed or unavailable — reset and retry next time
        try:
            sd._terminate()
            sd._initialize()
            print("Audio device changed — reinitialized PortAudio", file=sys.stderr, flush=True)
        except Exception:
            print("Audio unavailable — narration will resume when device returns", file=sys.stderr, flush=True)


def drain_to_latest(initial):
    """Drain the queue, returning the most recent item."""
    latest = initial
    while not narration_queue.empty():
        try:
            latest = narration_queue.get_nowait()
        except queue.Empty:
            break
    return latest


def narration_worker():
    """Single worker thread: debounce, then summarize and speak the latest event."""
    while True:
        text = narration_queue.get()

        # Debounce — wait briefly for more events to arrive
        time.sleep(DEBOUNCE_SECONDS)
        text = drain_to_latest(text)

        try:
            commentary = summarize(text)
            cleaned = commentary.strip().upper()
            if cleaned and cleaned != "SKIP":
                # Check if newer events arrived during summarization
                if not narration_queue.empty():
                    continue
                speak(commentary)
        except Exception as e:
            print(f"Narration error: {e}", file=sys.stderr, flush=True)


def handle_client(conn):
    """Read data from socket connection and enqueue for narration."""
    try:
        data = b""
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk

            # Fast-path: respond to PING immediately without waiting for EOF.
            # Bun's net module doesn't support half-close on Unix sockets, so
            # the client can't signal EOF via socket.end(). Detect PING early.
            if data.strip() == b"PING":
                try:
                    conn.sendall(b"PONG")
                except OSError:
                    pass
                conn.close()
                return

        text = data.decode("utf-8").strip()
        conn.close()

        if not text:
            return

        # Cancel any current speech — the worker will pick up the new event
        print(f"[narrate] received {len(text)} bytes: {text[:80]}...", file=sys.stderr, flush=True)
        cancel_event.set()
        narration_queue.put(text)
    except Exception as e:
        print(f"Socket error: {e}", file=sys.stderr, flush=True)


def cleanup(signum, frame):
    try:
        os.unlink(socket_path)
    except OSError:
        pass
    sys.exit(0)


def create_server_socket():
    """Create and bind the Unix socket, removing any stale one first."""
    try:
        os.unlink(socket_path)
    except OSError:
        pass

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(socket_path)
    server.listen(5)
    server.settimeout(5)  # Wake periodically so we can recover from sleep
    return server


def run_socket_server():
    """Accept loop for the Unix socket server, with auto-recovery."""
    server = create_server_socket()
    print(f"Ralph narration server listening on {socket_path}", flush=True)

    while True:
        try:
            conn, _ = server.accept()
            threading.Thread(target=handle_client, args=(conn,), daemon=True).start()
        except socket.timeout:
            # Normal timeout — loop back to accept. Keeps us from blocking
            # forever if the socket fd goes stale after system sleep.
            continue
        except OSError as e:
            # Socket broke (common after macOS sleep) — rebuild it
            print(f"Socket error in accept loop: {e} — rebuilding socket", file=sys.stderr, flush=True)
            try:
                server.close()
            except OSError:
                pass
            time.sleep(1)
            try:
                server = create_server_socket()
                print("Socket rebuilt successfully", file=sys.stderr, flush=True)
            except OSError as e2:
                print(f"Failed to rebuild socket: {e2} — retrying in 5s", file=sys.stderr, flush=True)
                time.sleep(5)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Ralph narration TTS server")
    parser.add_argument("--voice", default=os.environ.get("CAIRN_NARRATION_VOICE", DEFAULT_VOICE))
    parser.add_argument(
        "--socket",
        default=os.environ.get("CAIRN_NARRATE_SOCKET") or os.environ.get("RALPH_NARRATE_SOCKET", DEFAULT_SOCKET),
    )
    args = parser.parse_args()

    socket_path = args.socket
    voice = args.voice

    # Initialize heavy resources
    pipeline = KPipeline(lang_code="a" if voice.startswith("a") else "b")
    # CAIRN_ANTHROPIC_API_KEY -> legacy RALPH_ANTHROPIC_API_KEY -> plain ANTHROPIC_API_KEY.
    # The main loop blanks ANTHROPIC_API_KEY before spawning `claude` to force Max-plan
    # usage, so these prefixed names are what let this server still reach a real key.
    api_key = os.environ.get("CAIRN_ANTHROPIC_API_KEY")
    if not api_key:
        api_key = os.environ.get("RALPH_ANTHROPIC_API_KEY")
        if api_key:
            print(
                "[cairn] Using legacy RALPH_ANTHROPIC_API_KEY — rename to CAIRN_ANTHROPIC_API_KEY.",
                file=sys.stderr,
                flush=True,
            )
    if not api_key:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
    client = Anthropic(api_key=api_key)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # Start the single narration worker
    threading.Thread(target=narration_worker, daemon=True).start()

    run_socket_server()
