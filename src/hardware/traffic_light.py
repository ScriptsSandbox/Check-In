from enum import Enum

import serial


class TrafficLightState(Enum):
    OFF = "off"
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


class TrafficLight:
    def __init__(self, addr: str | None = None, baud: int = 115200) -> None:
        self.ser: serial.Serial | None = None

        if addr:
            self.ser = serial.Serial(addr, baud)
            self.ser.reset_input_buffer()

    def set_state(self, state: TrafficLightState) -> None:
        if self.ser:
            data_string = state.value + "\n"
            self.ser.write(data_string.encode())
