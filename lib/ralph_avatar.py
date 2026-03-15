#!/usr/bin/env python3
"""
Ralph avatar — a small floating tkinter window with an animated companion
face that syncs with narration events. Communicates via a thread-safe queue
so the narration server can update state from worker threads.

Loads PNG sprites from assets/ directory:
  idle.png            — default resting state
  thinking.png        — shown during Haiku summarization
  speaking_open.png   — mouth open frame
  speaking_closed.png — mouth closed frame

Falls back to simple Canvas-drawn face if images are missing.

Must run on the main thread (macOS tkinter requirement).
"""
import os
import queue
import random
import sys
import tkinter as tk


class AvatarWindow:
    """A small always-on-top window with an animated face."""

    BG = "#1a1a2e"
    TEXT_COLOR = "#a0a0b0"

    TARGET_SIZE = 200
    SPEAK_INTERVAL_MS = 250

    def __init__(self, assets_dir=None):
        self.root = tk.Tk()
        self.root.title("Ralph")
        self.root.configure(bg=self.BG)
        self.root.attributes("-topmost", True)
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Load sprite images
        if assets_dir is None:
            assets_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "assets",
            )
        self.sprites = self._load_sprites(assets_dir)
        self.use_sprites = bool(self.sprites)

        # Determine display size from loaded sprites or fallback
        if self.use_sprites:
            sample = self.sprites["idle"]
            self.img_w = sample.width()
            self.img_h = sample.height()
        else:
            self.img_w = self.TARGET_SIZE
            self.img_h = self.TARGET_SIZE

        # Position bottom-right
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        win_w = self.img_w
        win_h = self.img_h + 120
        x = screen_w - win_w - 20
        y = screen_h - win_h - 80
        self.root.geometry(f"{win_w}x{win_h}+{x}+{y}")

        if self.use_sprites:
            self.face_label = tk.Label(
                self.root,
                image=self.sprites.get("idle"),
                bg=self.BG,
                borderwidth=0,
            )
            self.face_label.pack(pady=(10, 0))
        else:
            self.canvas = tk.Canvas(
                self.root,
                width=self.img_w,
                height=self.img_h,
                bg=self.BG,
                highlightthickness=0,
            )
            self.canvas.pack(pady=(10, 0))

        # Subtitle label
        self.subtitle = tk.Label(
            self.root,
            text="listening...",
            font=("Helvetica", 11),
            fg=self.TEXT_COLOR,
            bg=self.BG,
            wraplength=self.img_w - 20,
            justify="center",
        )
        self.subtitle.pack(pady=(5, 10), padx=10)

        # Animation state
        self.state = "idle"
        self.speak_frame = 0
        self.speak_timer = None
        self.blink_timer = None
        self._closed = False

        # Thread-safe message queue
        self.msg_queue: queue.Queue = queue.Queue()

        # Initial draw and timers
        self._draw_face()
        if not self.use_sprites:
            self._schedule_blink()
        self._poll_queue()

    # ── Sprite loading ───────────────────────────────────────────────

    def _load_sprites(self, assets_dir):
        """Load PNG sprites from assets directory. Returns dict or empty."""
        sprites = {}
        expected = {
            "idle": "idle.png",
            "thinking": "thinking.png",
            "speaking_open": "speaking_open.png",
            "speaking_closed": "speaking_closed.png",
        }

        if not os.path.isdir(assets_dir):
            return {}

        for key, filename in expected.items():
            path = os.path.join(assets_dir, filename)
            if os.path.isfile(path):
                try:
                    img = tk.PhotoImage(file=path)
                    # Scale down if larger than target size
                    max_dim = max(img.width(), img.height())
                    if max_dim > self.TARGET_SIZE:
                        # Round up to get the subsample factor
                        scale = (max_dim + self.TARGET_SIZE - 1) // self.TARGET_SIZE
                        img = img.subsample(scale, scale)
                    sprites[key] = img
                except tk.TclError as e:
                    print(
                        f"Warning: could not load {path}: {e}",
                        file=sys.stderr,
                    )
                    return {}

        # Need at least idle to use sprites
        if "idle" not in sprites:
            return {}

        return sprites

    # ── Drawing ──────────────────────────────────────────────────────

    def _draw_face(self):
        if self._closed:
            return
        if self.use_sprites:
            self._draw_sprite()
        else:
            self._draw_canvas_face()

    def _draw_sprite(self):
        if self.state == "idle":
            img = self.sprites.get("idle")
        elif self.state == "thinking":
            img = self.sprites.get("thinking", self.sprites["idle"])
        elif self.state == "speaking":
            if self.speak_frame % 2 == 0:
                img = self.sprites.get("speaking_open", self.sprites["idle"])
            else:
                img = self.sprites.get(
                    "speaking_closed",
                    self.sprites.get("speaking_open", self.sprites["idle"]),
                )
        else:
            img = self.sprites.get("idle")

        if img:
            self.face_label.configure(image=img)

    # ── Canvas fallback (procedural face) ────────────────────────────

    FACE_COLOR = "#e8ddd3"
    EYE_WHITE = "#ffffff"
    PUPIL = "#2d2d2d"
    MOUTH = "#c0392b"
    ACCENT = "#6c5ce7"

    def _draw_canvas_face(self):
        c = self.canvas
        c.delete("all")
        cx = self.img_w // 2
        cy = self.img_h // 2
        r = 70

        c.create_oval(
            cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6,
            fill="", outline=self.ACCENT, width=1,
        )
        c.create_oval(
            cx - r, cy - r, cx + r, cy + r,
            fill=self.FACE_COLOR, outline=self.ACCENT, width=2,
        )
        self._draw_eyes(cx, cy, r)
        self._draw_mouth(cx, cy, r)

    def _draw_eyes(self, cx, cy, r, blink=False):
        c = self.canvas
        eye_y = cy - r * 0.12
        spread = r * 0.36
        er = r * 0.16

        for side in (-1, 1):
            ex = cx + side * spread
            if blink:
                c.create_line(
                    ex - er, eye_y, ex + er, eye_y,
                    fill=self.PUPIL, width=2, tags="eyes",
                )
            else:
                c.create_oval(
                    ex - er, eye_y - er * 0.85,
                    ex + er, eye_y + er * 0.85,
                    fill=self.EYE_WHITE, outline="", tags="eyes",
                )
                pr = er * 0.5
                px = py = 0.0
                if self.state == "thinking":
                    px = er * 0.3 * side
                    py = -er * 0.25
                c.create_oval(
                    ex + px - pr, eye_y + py - pr,
                    ex + px + pr, eye_y + py + pr,
                    fill=self.PUPIL, outline="", tags="eyes",
                )

    def _draw_mouth(self, cx, cy, r):
        c = self.canvas
        my = cy + r * 0.38
        mw = r * 0.3

        if self.state == "speaking":
            openness = [0.06, 0.18, 0.28, 0.18][self.speak_frame % 4]
            mh = r * openness
            c.create_oval(
                cx - mw, my - mh, cx + mw, my + mh,
                fill=self.MOUTH, outline="", tags="mouth",
            )
        else:
            c.create_arc(
                cx - mw, my - r * 0.12, cx + mw, my + r * 0.12,
                start=200, extent=140,
                style="arc", outline=self.PUPIL, width=2, tags="mouth",
            )

    # ── Animation timers ─────────────────────────────────────────────

    def _schedule_blink(self):
        delay = random.randint(2000, 5000)
        self.blink_timer = self.root.after(delay, self._blink)

    def _blink(self):
        if self._closed:
            return
        if self.state != "speaking":
            self.canvas.delete("eyes")
            cx = self.img_w // 2
            cy = self.img_h // 2
            self._draw_eyes(cx, cy, 70, blink=True)
            self.root.after(150, self._draw_canvas_face)
        self._schedule_blink()

    def _animate_speaking(self):
        if self._closed:
            return
        if self.state == "speaking":
            self.speak_frame += 1
            self._draw_face()
            self.speak_timer = self.root.after(
                self.SPEAK_INTERVAL_MS, self._animate_speaking
            )

    # ── Queue polling (main-thread safe) ─────────────────────────────

    def _poll_queue(self):
        if self._closed:
            return
        try:
            while True:
                msg_type, data = self.msg_queue.get_nowait()
                if msg_type == "state":
                    self._set_state(data)
                elif msg_type == "text":
                    self.subtitle.configure(text=data)
                elif msg_type == "quit":
                    self.root.quit()
                    return
        except queue.Empty:
            pass
        self.root.after(50, self._poll_queue)

    def _set_state(self, new_state):
        old = self.state
        self.state = new_state

        if new_state == "speaking" and old != "speaking":
            self.speak_frame = 0
            self._animate_speaking()
        elif new_state != "speaking" and self.speak_timer:
            self.root.after_cancel(self.speak_timer)
            self.speak_timer = None

        self._draw_face()

    def _on_close(self):
        self._closed = True
        self.root.quit()

    # ── Thread-safe public API ───────────────────────────────────────

    def set_state(self, state):
        """Set avatar state: 'idle', 'thinking', or 'speaking'."""
        if not self._closed:
            self.msg_queue.put(("state", state))

    def set_text(self, text):
        """Update subtitle text."""
        if not self._closed:
            self.msg_queue.put(("text", text))

    def quit(self):
        if not self._closed:
            self.msg_queue.put(("quit", None))

    def run(self):
        """Start the tkinter main loop (must be called from main thread)."""
        self.root.mainloop()
