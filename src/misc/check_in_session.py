from __future__ import annotations

import logging
from typing import Literal

from hardware.traffic_light import TrafficLightState
from misc.api_models import Student
from misc.global_context import context


class CheckInSession:
    def __init__(self) -> None:
        self.rfid: str = ""
        self.check_in_method: Literal["rfid", "pid"] = "rfid"
        self.check_in_identifier: str = ""
        self.pid: str = ""
        self.first_name: str = ""
        self.last_name: str = ""
        self.email: str = ""

        logging.info("session initialized")

    def set_student(self, student: Student) -> None:
        self.pid = student.pid
        self.first_name = student.first_name
        self.last_name = student.last_name
        self.email = student.email

    def reset(self) -> None:
        self.rfid = ""
        self.check_in_method = "rfid"
        self.check_in_identifier = ""
        self.pid = ""
        self.first_name = ""
        self.last_name = ""
        self.email = ""
        context().traffic_light_controller.request_state_async(TrafficLightState.OFF)
