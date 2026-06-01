from enum import Enum
from pathlib import Path

ASSETS_PATH = Path(__file__).parent.parent / "assets"


class Asset(Enum):
    BACKGROUND = "background_main.png"
    QR_WAIVER = "qr_waiver.png"
    QR_WEBSITE = "qr_website.png"
    FONTS_DIR = "fonts/"

    def get_path(self) -> str:
        return str(ASSETS_PATH / self.value)