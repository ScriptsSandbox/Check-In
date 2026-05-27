import time
import logging
import traceback
from os.path import exists
from threading import Thread, Event

from controllers.api_controller import ApiController
from views.create_account_manual import CreateAccountManual
import notifier


class RfidReaderController:
    def __init__(self, ctx):
        self.ctx = ctx
        self._stop = Event()
        self._thread = None
        self._reader = None
        self._on_disconnect = None
        self._disconnect_fired = False

    def start(self, reader, on_disconnect):
        self._reader = reader
        self._on_disconnect = on_disconnect
        self._stop.clear()
        self._disconnect_fired = False
        self._thread = Thread(target=self._run_safe, args=(reader,), daemon=True, name="rfid-reader")
        self._thread.start()
        if self.ctx.traffic_light.connected:
            poller = Thread(target=self._poll_traffic_light, daemon=True, name="traffic-light-poll")
            poller.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3)
        if self._reader is not None:
            self._reader.close()

    def _fire_disconnect(self, reason):
        if self._disconnect_fired:
            return
        self._disconnect_fired = True
        self._stop.set()
        cb = self._on_disconnect
        if cb is not None:
            self.ctx.dispatcher.call.emit(lambda: cb(reason))

    def _run_safe(self, reader):
        try:
            self._run(reader)
        except BaseException as e:
            tb = traceback.format_exc()
            logging.critical("RFID reader thread died: %s\n%s", e, tb)
            notifier.notify_critical(
                "RFID reader thread died",
                f"{type(e).__name__}: {e}\n\n{tb[-1500:]}",
            )
            self._fire_disconnect(f"{type(e).__name__}: {e}")

    def _run(self, reader):
        logging.info("now reading ID cards")
        last_tag = 0
        last_time = 0

        while not self._stop.is_set():
            if not exists(reader._usb_id):
                logging.error("card reader device node missing: %s", reader._usb_id)
                self._fire_disconnect(f"Card reader at {reader._usb_id} no longer present")
                return

            try:
                in_waiting = reader.get_ser_in_waiting()
            except OSError as e:
                if not exists(reader._usb_id):
                    logging.error("card reader disconnected: %s", e)
                    self._fire_disconnect(f"Card reader at {reader._usb_id} no longer present")
                    return
                logging.debug("card reader transient error, retrying: %s", e)
                time.sleep(0.2)
                continue

            if in_waiting >= 14:
                self.ctx.dispatcher.call.emit(
                    lambda: self.ctx.nav.get_frame(CreateAccountManual).clear_entries()
                )
                tag = reader.grab_rfid()

                if " " in tag:
                    continue

                if tag == last_tag and not reader.can_scan_again(last_time):
                    logging.debug("suppressing repeat scan")
                    continue

                s_reason = reader.check_rfid(tag)

                if s_reason != "good":
                    logging.debug(s_reason)
                    continue
                else:
                    logging.debug("RFID check succeeded")

                self.ctx.rfid = tag
                self.ctx.check_in.handle_by_uuid(tag)

                last_tag = tag
                last_time = time.time()

    def _poll_traffic_light(self):
        last_color = None
        while not self._stop.is_set():
            time.sleep(0.1)
            try:
                color = ApiController.get_traffic_light()
            except Exception as e:
                logging.warning("traffic light poll error: %s", e)
                continue
            if color != last_color:
                last_color = color
                self.ctx.traffic_light.drive(color)
