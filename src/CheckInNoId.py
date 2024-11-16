# Part of this file was generated by the Tkinter Designer by Parth Jadhav
# https://github.com/ParthJadhav/Tkinter-Designer

from pathlib import Path
from tkinter import *
from utils import *
from NoAccCheckInOnly import NoAccCheckInOnly
from CheckInReason import CheckInReason
import logging

OUTPUT_PATH = Path(__file__).parent
ASSETS_PATH = OUTPUT_PATH / Path(r"assets/check_in_no_id_assets")


def relative_to_assets(path: str) -> Path:
    return ASSETS_PATH / Path(path)


########################################################
# This is the frame where users will manually check in #
########################################################


class CheckInNoId(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.photoList = []
        self.pid = StringVar()
        self.pid_entry = 0

        self.loadWidgets(controller)

    def loadWidgets(self, controller):
        canvas = Canvas(
            self,
            bg="#153246",
            height=720,
            width=1280,
            bd=0,
            highlightthickness=0,
            relief="ridge",
        )

        canvas.place(x=0, y=0)
        image_image_1 = PhotoImage(file=relative_to_assets("image_1.png"))

        self.photoList.append(image_image_1)

        image_1 = canvas.create_image(640.0, 360.0, image=image_image_1)

        image_image_2 = PhotoImage(file=relative_to_assets("image_2.png"))

        self.photoList.append(image_image_2)

        image_2 = canvas.create_image(640.0, 360.0, image=image_image_2)

        image_image_3 = PhotoImage(file=relative_to_assets("image_3.png"))

        self.photoList.append(image_image_3)

        image_3 = canvas.create_image(640.0, 424.0, image=image_image_3)

        canvas.create_text(
            212.0,
            120.0,
            anchor="nw",
            text="If you have already made an\naccount, scan your UCSD barcode\nor enter your PID manually",
            fill="#F5F0E6",
            font=("Montserrat", 48 * -1),
            justify="center",
        )

        canvas.create_text(
            605.0,
            480.0,
            anchor="nw",
            text="PID",
            fill="#F5F0E6",
            font=("Montserrat", 24 * -1),
        )

        button_image_1 = PhotoImage(file=relative_to_assets("button_1.png"))

        self.photoList.append(button_image_1)

        self.button_1 = Button(
            self,
            image=button_image_1,
            borderwidth=0,
            highlightthickness=0,
            command=lambda: self.callCheckIn(controller),
            relief="flat",
        )
        self.button_1.place(x=465.0, y=598.0, width=349.0, height=71.0)

        self.pid_entry = Entry(self, textvariable=self.pid, width=40, font=52)
        self.pid_entry.place(x=420.0, y=412.0)

    def clearEntries(self):
        self.pid_entry.delete(0, END)

    def updateEntries(self, pid):
        self.pid_entry.insert(0, pid)

    def callCheckIn(self, controller):
        pid = self.pid_entry.get().lstrip("Aa")
        if not pid:
            return

        util = utils()
        self.clearEntries()

        curr_user = None

        user_data = global_.sheets.get_user_db_data()
        for i in user_data:
            student_id = i["Student ID"].lstrip("Aa")
            if student_id == pid:
                curr_user = i

        if not curr_user:
            logging.info("Manual check in user account was not found")
            controller.show_frame(NoAccCheckInOnly)
            controller.after(5000, lambda: controller.show_frame(MainPage))
            return

        new_row = [
            util.getDatetime(),
            int(time.time()),
            curr_user["Name"],
            "No ID",
            "User Checkin",
            "",
            "",
            "",
        ]

        check_in_reason = global_.app.get_frame(CheckInReason)
        check_in_reason.setCheckInUser(new_row)
        controller.show_frame(CheckInReason)
