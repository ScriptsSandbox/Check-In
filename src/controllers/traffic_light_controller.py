import logging
import threading
import time

from controllers.api_controller import APIController
from misc.global_config import config
from misc.global_context import context
from misc.timeout import run_with_timeout
from hardware.traffic_light import TrafficLight, TrafficLightState
from hardware.usb_ports import USBDevice


class TrafficLightController:
    def __init__(self) -> None:
        if config().HAS_TRAFFIC_LIGHT:
            logging.info("opening traffic light serial port")
            port = context().usb_port_controller.get_usb_device_port(USBDevice.TRAFFIC_LIGHT)
            self._traffic_light = run_with_timeout(lambda: TrafficLight(port), "traffic light")
            self._stop = threading.Event()
            poller = threading.Thread(target=self._poll_traffic_light, daemon=True, name="traffic-light-poll")
            poller.start()
            self.request_state_async(TrafficLightState.OFF)

        logging.info("traffic light controller initialized")

    def stop(self) -> None:
        self._stop.set()

    def request_state_async(self, state: TrafficLightState) -> None:
        def push() -> None:
            try:
                context().api_controller.request("POST", "/traffic-light", json={"state": state.value})
            except Exception as e:
                logging.error(f"error setting traffic light: {e}")

        threading.Thread(target=push, daemon=True).start()

    def _poll_traffic_light(self) -> None:
        last_state: TrafficLightState | None = None
        while not self._stop.is_set():
            time.sleep(0.1)
            try:
                resp = context().api_controller.request("GET", "/traffic-light")
                traffic_light_state = TrafficLightState(resp.json().get("state"))
            except Exception as e:
                logging.warning("traffic light poll error: %s", e)
                continue
            if traffic_light_state != last_state:
                last_state = traffic_light_state
                self._traffic_light.set_state(traffic_light_state)
