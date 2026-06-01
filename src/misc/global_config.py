import os
from dataclasses import dataclass

_config: GlobalConfig | None = None


def config() -> GlobalConfig:
    global _config
    if not _config:
        _config = GlobalConfig()
    return _config


def _from_env(key: str, required: bool) -> str:
    value = os.environ.get(key)
    if value is None:
        if required:
            raise RuntimeError(f"Missing environment variable: {key}")
        else:
            return ""

    return value


@dataclass
class GlobalConfig:
    # hardcoded config values
    API_RETRY_DELAY_SECONDS: int = 10
    API_MONITOR_INTERVAL_SECONDS: int = 15
    HARDWARE_RETRY_DELAY_SECONDS: int = 5
    HEALTH_SERVER_PORT: int = 8001
    DISCORD_CRITICAL_ALERT_ROLE_ID = "1509027158209859695"
    SCREEN_WIDTH: int = 1280
    SCREEN_HEIGHT: int = 720

    # values pulled from env
    KIOSK_NAME: str = _from_env("KIOSK_NAME", required=True)
    HAS_BARCODE_SCANNER: bool = _from_env("HAS_BARCODE_SCANNER", required=True).lower() == "true"
    HAS_TRAFFIC_LIGHT: bool = _from_env("HAS_TRAFFIC_LIGHT", required=True).lower() == "true"
    CHECK_IN_API_URL: str = _from_env("CHECK_IN_API_URL", required=True)
    DISCORD_WEBHOOK_URL: str = _from_env("DISCORD_WEBHOOK_URL", required=False)
    DEV_MODE: bool = _from_env("DEV_MODE", required=False).lower() == "true"
    VERBOSE_LOGGING: bool = _from_env("VERBOSE_LOGGING", required=False).lower() == "true"