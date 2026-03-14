#!/usr/bin/env python3
"""
Ralph narration server — listens on a Unix socket, summarizes events via
Claude Haiku, and speaks them aloud using Kokoro TTS.

Usage:
    python3 ralph_narrate_server.py [--voice VOICE] [--socket PATH]
"""
import json
import os
import signal
import socket
import sys
import threading

import sounddevice as sd
from kokoro import KPipeline
from anthropic import Anthropic

DEFAULT_SOCKET = "/tmp/ralph-tts.sock"
DEFAULT_VOICE = "bf_emma"

COMPANION_PROMPT = """\
You are a sassy programming companion with a dry wit, narrating what's happening in a coding session. \
You receive output from a Claude Code assistant — either a tool use event (JSON with tool name, input, output) \
or a final assistant message — and summarize it as brief, punchy spoken commentary, \
like a slightly sarcastic coworker watching over someone's shoulder.

Rules:
- Keep it to 1-2 short sentences, be succinct
- Light sarcasm and dry humor are encouraged — think deadpan, not mean
- Focus on what just happened, editorialize a little
- Never read out code, file paths, or terminal output verbatim
- If it's a question to the user, rephrase it with a bit of attitude
- If it's just a small acknowledgment, a quip or a few words is fine
- If a tool action is trivial or routine (like reading a file), say SKIP and nothing else
- No markdown, no formatting — this will be spoken aloud"""

# Globals set in main()
pipeline = None
client = None
voice = DEFAULT_VOICE

# Lock so only one narration plays at a time
speak_lock = threading.Lock()
cancel_event = threading.Event()


def summarize(text):
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=COMPANION_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    return response.content[0].text


def speak(text):
    cancel_event.clear()
    for _, _, audio in pipeline(text, voice=voice):
        if cancel_event.is_set():
            sd.stop()
            return
        sd.play(audio, samplerate=24000)
        while sd.get_stream().active:
            if cancel_event.is_set():
                sd.stop()
                return
            sd.wait()


def handle_client(conn):
    try:
        data = b""
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            data += chunk
        conn.close()

        text = data.decode("utf-8").strip()
        if not text:
            return

        # Cancel any current narration
        cancel_event.set()
        with speak_lock:
            commentary = summarize(text)
            cleaned = commentary.strip().upper()
            if cleaned and cleaned != "SKIP":
                speak(commentary)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr, flush=True)


def cleanup(signum, frame):
    try:
        os.unlink(socket_path)
    except OSError:
        pass
    sys.exit(0)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Ralph narration TTS server")
    parser.add_argument("--voice", default=os.environ.get("RALPH_NARRATION_VOICE", DEFAULT_VOICE))
    parser.add_argument("--socket", default=os.environ.get("RALPH_NARRATE_SOCKET", DEFAULT_SOCKET))
    args = parser.parse_args()

    socket_path = args.socket
    voice = args.voice

    # Initialize heavy resources
    pipeline = KPipeline(lang_code="a" if voice.startswith("a") else "b")
    client = Anthropic()

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # Clean up stale socket
    try:
        os.unlink(socket_path)
    except OSError:
        pass

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(socket_path)
    server.listen(5)
    print(f"Ralph narration server listening on {socket_path}", flush=True)

    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()
