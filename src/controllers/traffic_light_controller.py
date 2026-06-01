import logging
import threading
import time

from controllers.api_controller import ApiController
from global_config import config
from global_context import context
from hardware.traffic_light import TrafficLight, TrafficLightState
from hardware.usb_ports import USBDevice


class TrafficLightController:
    _traffic_light: TrafficLight

    def __init__(self) -> None:
        pass

    def start(self) -> None:
        if config().HAS_TRAFFIC_LIGHT:
            self._traffic_light = TrafficLight(context().usb_port_controller.get_usb_device_port(USBDevice.TRAFFIC_LIGHT))
            self._stop = threading.Event()
            poller = threading.Thread(target=self._poll_traffic_light, daemon=True, name="traffic-light-poll")
            poller.start()
            self.request_state(TrafficLightState.OFF)

    def stop(self) -> None:
        self._stop.set()

    def drive(self, state: TrafficLightState) -> None:
        self._traffic_light.set_state(state)

    def _post(self, state: TrafficLightState) -> None:
        threading.Thread(
            target=ApiController.set_traffic_light,
            args=(state.value,),
            daemon=True,
        ).start()

    def request_state(self, state: TrafficLightState) -> None:
        self._post(state)

    def _poll_traffic_light(self) -> None:
        last_state: TrafficLightState | None = None
        while not self._stop.is_set():
            time.sleep(0.1)
            try:
                traffic_light_state = ApiController.get_traffic_light()
            except Exception as e:
                logging.warning("traffic light poll error: %s", e)
                continue
            if traffic_light_state != last_state:
                last_state = traffic_light_state
                context().traffic_light_controller.drive(traffic_light_state)
