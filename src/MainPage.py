# MainPage.py ? pixel-perfect, centered, scalable (tuned)
from pathlib import Path
from tkinter import *
from tkinter import font

# Pillow (for high-quality resize). Falls back cleanly if not present.
try:
    from PIL import Image, ImageTk
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False

# ---------- Paths / assets ----------
OUTPUT_PATH = Path(__file__).parent
ASSETS = OUTPUT_PATH / "assets" / "main_page_assets"
def asset(name: str) -> str:
    return str(ASSETS / name)

# ---------- Brand tokens ----------
BG     = "#5C626A"   # background gray
CREAM  = "#F5F0E6"   # light text
ORANGE = "#F7931E"   # accent

# Figma reference stage
BASE_W, BASE_H = 1920, 1080


class MainPage(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent, bg=BG)
        self.controller = controller

        self.canvas = Canvas(self, bg=BG, highlightthickness=0, bd=0)
        self.canvas.pack(fill="both", expand=True)

        # Preload sources
        self.logo_src   = self._open_img("ScrippsSandboxMakerspaceIllustration_main.png")
        self.btn_bg_src = self._open_img("image_3.png")  # rounded square (for QR only)
        self.qr_src     = self._open_img("image_4.png")  # QR glyph

        # Tk image handles (keep refs on self to avoid GC)
        self.logo_img = self.qr_bg_img = self.qr_img = None

        # Click hitboxes
        self.hit_qr = None
        self.hit_noid = None

        # Redraw bindings
        self._redraw_pending = False
        self.bind("<Configure>", self._redraw)          # frame resize
        self.canvas.bind("<Configure>", self._redraw)   # canvas resize
        self.canvas.bind("<Button-1>", self._on_click)

        # First draw after window maps
        self.after(0, self._redraw)

    # ---------- Redraw orchestration (debounced) ----------
    def _redraw(self, event=None):
        if self._redraw_pending:
            return
        self._redraw_pending = True
        self.after_idle(self._do_redraw)

    def _do_redraw(self):
        self._redraw_pending = False

        w = max(self.canvas.winfo_width(), 1)
        h = max(self.canvas.winfo_height(), 1)

        # During first layout, sizes can be tiny; wait a tick
        if w < 100 or h < 100:
            self.after(50, self._redraw)
            return

        # Uniform scale to maintain 1920x1080 aspect; center (letterbox)
        s  = min(w / BASE_W, h / BASE_H)
        ox = int((w - BASE_W * s) // 2)
        oy = int((h - BASE_H * s) // 2)

        self.canvas.delete("all")
        self.hit_qr = self.hit_noid = None

        # ---------- BIG LOGO (left circle) ----------
        # Tuned smaller & slightly up/left vs earlier version
        logo_d  = max(1, int(850 * s))
        logo_cx = ox + int(400 * s)
        logo_cy = oy + int(500 * s)
        self.logo_img = self._resize_img(self.logo_src, (logo_d, logo_d))
        self.canvas.create_image(logo_cx, logo_cy, image=self.logo_img)

        # ---------- TOP-LEFT QR button (rounded square + icon) ----------
        pad      = int(30 * s)
        btn_size = max(1, int(90 * s))
        qr_size  = max(1, int(65 * s))

        self.qr_bg_img = self._resize_img(self.btn_bg_src, (btn_size, btn_size))
        qrx = ox + pad + btn_size // 2
        qry = oy + pad + btn_size // 2
        self.canvas.create_image(qrx, qry, image=self.qr_bg_img)

        self.qr_img = self._resize_img(self.qr_src, (qr_size, qr_size))
        self.canvas.create_image(qrx, qry, image=self.qr_img)

        self.hit_qr = (ox + pad, oy + pad, ox + pad + btn_size, oy + pad + btn_size)

        # ---------- TOP-RIGHT "No ID" button (wider pill, drawn vector) ----------
        pill_pad  = int(30 * s)
        pill_w    = int(130 * s)   # wider than tall
        pill_h    = int(90 * s)
        pill_r    = max(8, int(14 * s))

        x2 = ox + int(BASE_W * s) - pill_pad
        y1 = oy + pill_pad
        x1 = x2 - pill_w
        y2 = y1 + pill_h

        self._round_rect(x1, y1, x2, y2, r=pill_r, outline=CREAM, width=max(2, int(3 * s)))
        noid_font = font.Font(family="Inter", size=-max(1, int(28 * s)), weight="bold")
        self.canvas.create_text(
            x1 + pill_w // 2, y1 + pill_h // 2,
            text="No\nID", font=noid_font, fill=CREAM, anchor="c"
        )
        self.hit_noid = (x1, y1, x2, y2)

        # ---------- TITLES (right side) ----------
        fam = "Refrigerator Deluxe"
        try:
            _ = font.Font(family=fam, size=10)  # probe for availability
        except Exception:
            fam = "Arial Black"

        # Tuned left/down & larger gap
        t_left = ox + int(900 * s)
        t_top  = oy + int(380 * s)

        welcome_font = font.Font(family=fam, size=-max(1, int(140 * s)), weight="bold")
        checkin_font = font.Font(family=fam, size=-max(1, int(180 * s)), weight="bold")

        self.canvas.create_text(t_left, t_top, text="WELCOME",
                                font=welcome_font, fill=ORANGE, anchor="nw")

        gap    = int(40 * s)  # more breathing room
        next_y = t_top + abs(welcome_font.cget("size")) + gap
        self.canvas.create_text(t_left, next_y, text="CHECK-IN HERE",
                                font=checkin_font, fill=CREAM, anchor="nw")

        # ---------- FOOTER (lower) ----------
        footer_font = font.Font(family="Inter", size=-max(1, int(32 * s)))
        stage_cx = ox + int((BASE_W * s) // 2)
        stage_by = oy + int(BASE_H * s) - int(30 * s)  # closer to bottom
        self.canvas.create_text(stage_cx, stage_by,
                                text="Please tap ID on the black box to sign in",
                                font=footer_font, fill=CREAM, anchor="c")

    # ---------- Click handling ----------
    def _on_click(self, e):
        if self.hit_qr and self._inside(e.x, e.y, self.hit_qr):
            from QRCodes import QRCodes
            self.controller.show_frame(QRCodes); return
        if self.hit_noid and self._inside(e.x, e.y, self.hit_noid):
            from CheckInNoId import CheckInNoId
            self.controller.show_frame(CheckInNoId); return

    @staticmethod
    def _inside(x, y, rect):
        x1, y1, x2, y2 = rect
        return x1 <= x <= x2 and y1 <= y <= y2

    # ---------- Drawing helpers ----------
    def _round_rect(self, x1, y1, x2, y2, r=12, outline=CREAM, width=2, fill=""):
        # Draw a rounded rectangle (vector) so we can make a wider pill cleanly
        # Sides
        self.canvas.create_line(x1 + r, y1, x2 - r, y1, fill=outline, width=width)
        self.canvas.create_line(x2, y1 + r, x2, y2 - r, fill=outline, width=width)
        self.canvas.create_line(x1 + r, y2, x2 - r, y2, fill=outline, width=width)
        self.canvas.create_line(x1, y1 + r, x1, y2 - r, fill=outline, width=width)
        # Corners
        self.canvas.create_arc(x1, y1, x1 + 2 * r, y1 + 2 * r, start=90, extent=90,
                               style="arc", outline=outline, width=width)
        self.canvas.create_arc(x2 - 2 * r, y1, x2, y1 + 2 * r, start=0, extent=90,
                               style="arc", outline=outline, width=width)
        self.canvas.create_arc(x2 - 2 * r, y2 - 2 * r, x2, y2, start=270, extent=90,
                               style="arc", outline=outline, width=width)
        self.canvas.create_arc(x1, y2 - 2 * r, x1 + 2 * r, y2, start=180, extent=90,
                               style="arc", outline=outline, width=width)
        if fill:
            # Optional: draw a filled base first (rounded polygon) before the outline
            pass

    # ---------- Image helpers ----------
    def _open_img(self, name):
        p = asset(name)
        if HAVE_PIL:
            return Image.open(p).convert("RGBA")
        # Fallback: Tk's PhotoImage (no HQ resize, but keeps app running)
        return PhotoImage(file=p)

    def _resize_img(self, src, size):
        w = max(1, int(size[0]))
        h = max(1, int(size[1]))
        if HAVE_PIL and isinstance(src, Image.Image):
            return ImageTk.PhotoImage(src.resize((w, h), Image.LANCZOS))
        # Fallback path ignores requested size
        return src
