#!/usr/bin/env python3
"""
Standalone narration utility — speaks text directly via Kokoro TTS.
No server needed.

Usage:
    python3 ralph_narrate.py "text to speak"
    echo "text" | python3 ralph_narrate.py
"""
import os
import sys
import threading

import sounddevice as sd
import tty
import termios
from kokoro import KPipeline

DEFAULT_VOICE = "bf_emma"

pipeline = None
stop_event = threading.Event()


def listen_for_stop():
    try:
        fd = open("/dev/tty", "r")
    except OSError:
        return
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        while not stop_event.is_set():
            ch = fd.read(1)
            if ch in ("q", " ", "\x03"):
                stop_event.set()
                sd.stop()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        fd.close()


def narrate(text, voice=DEFAULT_VOICE):
    global pipeline
    if pipeline is None:
        pipeline = KPipeline(lang_code="a" if voice.startswith("a") else "b")

    stop_event.clear()
    listener = threading.Thread(target=listen_for_stop, daemon=True)
    listener.start()

    for _, _, audio in pipeline(text, voice=voice):
        if stop_event.is_set():
            break
        sd.play(audio, samplerate=24000)
        while sd.get_stream().active:
            if stop_event.is_set():
                sd.stop()
                break
            threading.Event().wait(0.05)

    stop_event.set()


if __name__ == "__main__":
    voice = os.environ.get("CAIRN_NARRATION_VOICE", DEFAULT_VOICE)

    if len(sys.argv) > 1:
        text = " ".join(sys.argv[1:])
    else:
        text = sys.stdin.read()

    if text.strip():
        narrate(text.strip(), voice=voice)
