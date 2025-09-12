import uuid
import tkinter as tk
import global_
from AccNoWaiver import AccNoWaiver
from MainPage import MainPage
from AccNoWaiverSwipe import AccNoWaiverSwipe
from ManualFill import ManualFill
from CheckInNoId import CheckInNoId
from NoAccCheckInOnly import NoAccCheckInOnly
from NoAccNoWaiver import NoAccNoWaiver
from NoAccNoWaiverSwipe import NoAccNoWaiverSwipe
from QRCodes import QRCodes
from UserThank import UserThank
from UserWelcome import UserWelcome
from WaiverNoAcc import WaiverNoAcc
from WaiverNoAccSwipe import WaiverNoAccSwipe
from linking import UnlinkedCard, EmailLookup, MinimalInfo


TIMEOUT_DICT = {AccNoWaiverSwipe: 30000, QRCodes: 30000, NoAccNoWaiverSwipe: 30000}


#################################################
# Acts as the controller and the user interface #
#################################################
class gui(tk.Tk):
    def __init__(self, *args, **kwargs):
        tk.Tk.__init__(self, *args, **kwargs)

        self.title("Check-In")
        self.geometry("1280x720")
        self.after(10000, lambda: self.attributes("-fullscreen", True))

        container = tk.Frame(self)

        container.pack(side="top", fill="both", expand=True)
        container.grid_rowconfigure(0, weight=1)
        container.grid_columnconfigure(0, weight=1)

        self.frames = {}
        self.curr_frame = None
        self.frame_uuid = uuid.uuid4().hex

        for F in (
            MainPage,
            AccNoWaiver,
            AccNoWaiverSwipe,
            ManualFill,
            CheckInNoId,
            NoAccCheckInOnly,
            NoAccNoWaiver,
            NoAccNoWaiverSwipe,
            QRCodes,
            UserThank,
            UserWelcome,
            WaiverNoAcc,
            WaiverNoAccSwipe,
            UnlinkedCard,
            EmailLookup,
            MinimalInfo,
        ):
            frame = F(container, self)
            self.frames[F] = frame
            frame.grid(row=0, column=0, sticky="nsew")

        self.show_frame(MainPage)

    def timeout_fn(self, curr_uuid):
        if curr_uuid == self.frame_uuid:
            self.show_frame(MainPage)
            global_.traffic_light.set_off()

    def show_frame(self, cont):
        frame = self.frames[cont]
        self.curr_frame = cont
        self.frame_uuid = uuid.uuid4().hex
        frame.tkraise()

        if cont in TIMEOUT_DICT:
            curr_uuid = self.frame_uuid
            self.after(TIMEOUT_DICT[cont], lambda: self.timeout_fn(curr_uuid))

    def get_frame(self, cont):
        return self.frames[cont]

    def get_curr_frame(self):
        return self.curr_frame

    def start(self):
        self.mainloop()
