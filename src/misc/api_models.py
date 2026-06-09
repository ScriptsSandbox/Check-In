from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, TypeAdapter, model_validator

"""
IT SHOULD BE ENSURED ANY UPDATES TO THIS FILE ARE ALSO MADE AT THE CORRESPONDING LOCATIONS:
 - Check-In/src/misc/api_models.py
 - check-in-api/src/api_models.py
"""

class HealthResponse(BaseModel):
    status: str
    timestamp: str


class TrafficLightState(str, Enum):
    OFF = "off"
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


class TrafficLightRequest(BaseModel):
    state: TrafficLightState


class TrafficLightResponse(BaseModel):
    state: TrafficLightState


class Student(BaseModel):
    first_name: str
    last_name: str
    email: str
    pid: str


class StudentResponse(BaseModel):
    student: Student


class AccountRequest(BaseModel):
    rfid: str
    barcode: str | None = None
    pid: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None

    @model_validator(mode="after")
    def check_inputs(self) -> AccountRequest:
        if not self.rfid.strip():
            raise ValueError("rfid must not be empty")
        has_lookup = self.barcode or self.pid
        has_manual = self.first_name and self.last_name and self.email
        if not has_lookup and not has_manual:
            raise ValueError("Either barcode, pid, or first/last/email must be provided")
        return self


class CreateAccountResponse(BaseModel):
    status: str


class CheckInRequest(BaseModel):
    email: str


class CheckInStatus(str, Enum):
    OK = "ok"
    NO_ACCOUNT = "no_account"
    NO_WAIVER = "no_waiver"


class CheckInNoAccount(BaseModel):
    status: CheckInStatus = CheckInStatus.NO_ACCOUNT


class CheckInNoWaiver(BaseModel):
    status: CheckInStatus = CheckInStatus.NO_WAIVER
    name: str


class CheckInOk(BaseModel):
    status: CheckInStatus = CheckInStatus.OK
    name: str
    student_id: str
    timestamp: str
    email: str
    first_enr_term: str
    last_enr_term: str


CheckInResponse = CheckInOk | CheckInNoWaiver | CheckInNoAccount
check_in_response_validator: TypeAdapter[CheckInResponse] = TypeAdapter(CheckInResponse)
