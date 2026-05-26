import logging
import sys
import time
import requests

from config import API_BASE_URL

SILENT_PATHS = frozenset(["/health", "/traffic-light"])


class ExternalApiError(Exception):
    def __init__(self, api: str):
        self.api = api
        super().__init__(f"External API error: {api}")


class ApiController:
    @staticmethod
    def _req(method, path, **kwargs):
        url = f"{API_BASE_URL}{path}"
        start = time.time()
        resp = requests.request(method, url, **kwargs)
        ms = (time.time() - start) * 1000
        if resp.status_code == 502:
            raise ExternalApiError(resp.json().get("api", "unknown"))
        if path not in SILENT_PATHS:
            logging.info(f"[CLIENT] {method.upper()} {url} -> {resp.status_code} ({ms:.0f}ms)")
        return resp

    @staticmethod
    def check_api_health():
        delay_seconds = 3
        retries = 3

        logging.info(API_BASE_URL)
        for attempt in range(1, retries + 1):
            try:
                resp = ApiController._req("GET", "/health", timeout=5)
                if resp.ok:
                    logging.info(f"API reachable at {API_BASE_URL}")
                    return
            except Exception:
                pass
            logging.warning(f"API not reachable (attempt {attempt}/{retries}), retrying in {delay_seconds}s")
            time.sleep(delay_seconds)
        logging.critical(f"API at {API_BASE_URL} unreachable after {retries} attempts, exiting")
        sys.exit(1)

    @staticmethod
    def checkin_by_uuid(uuid):
        try:
            resp = ApiController._req("GET", f"/check-in/uuid/{uuid}", timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logging.error(f"error during check-in for uuid {uuid}: {e}")
            return {"status": "api_error"}

    @staticmethod
    def checkin_by_pid(pid):
        try:
            resp = ApiController._req("GET", f"/check-in/pid/{pid}", timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logging.error(f"error during check-in for pid {pid}: {e}")
            return {"status": "api_error"}

    @staticmethod
    def set_traffic_light(color):
        try:
            ApiController._req("POST", "/traffic-light", json={"color": color}, timeout=5)
        except Exception as e:
            logging.error(f"error setting traffic light: {e}")

    @staticmethod
    def get_traffic_light():
        try:
            resp = ApiController._req("GET", "/traffic-light", timeout=5)
            return resp.json().get("color", "off")
        except Exception as e:
            logging.error(f"error getting traffic light: {e}")
            return "off"

    @staticmethod
    def lookup_by_pid(pid):
        try:
            resp = ApiController._req("GET", f"/accounts/lookup/pid/{pid}", timeout=10)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logging.error(f"error looking up student by pid {pid}: {e}")
            return None

    @staticmethod
    def lookup_by_barcode(barcode):
        try:
            resp = ApiController._req("GET", f"/accounts/lookup/barcode/{barcode}", timeout=10)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logging.error(f"error looking up student by barcode: {e}")
            return None

    @staticmethod
    def create_account(rfid, *, barcode, pid, first_name, last_name, email):
        try:
            payload = {"rfid": rfid}
            if barcode:
                payload["barcode"] = barcode
            if pid:
                payload["pid"] = pid
            if first_name:
                payload["first_name"] = first_name
            if last_name:
                payload["last_name"] = last_name
            if email:
                payload["email"] = email
            resp = ApiController._req("POST", "/accounts", json=payload, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logging.error(f"error creating account: {e}")
            return None
