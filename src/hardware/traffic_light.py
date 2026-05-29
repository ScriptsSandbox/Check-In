import serial
import serial.tools.list_ports as list_ports
import time


class TrafficLight:
    def __init__(self, addr: str | None = None, baud: int = 115200) -> None:
        self.ser: serial.Serial | None = None

        if addr:
            self.ser = serial.Serial(addr, baud)
            self.ser.reset_input_buffer()

    @property
    def connected(self) -> bool:
        return self.ser is not None

    def set_off(self) -> None:
        if self.ser:
            self.ser.write(b"off\n")

    def set_red(self) -> None:
        if self.ser:
            self.ser.write(b"red\n")

    def set_yellow(self) -> None:
        if self.ser:
            self.ser.write(b"yellow\n")

    def set_green(self) -> None:
        if self.ser:
            self.ser.write(b"green\n")
