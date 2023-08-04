
# Part of this file was generated by the Tkinter Designer by Parth Jadhav
# https://github.com/ParthJadhav/Tkinter-Designer


from pathlib import Path

# from tkinter import *
# Explicit imports to satisfy Flake8
from tkinter import *

from MainPage import *


OUTPUT_PATH = Path(__file__).parent
ASSETS_PATH = OUTPUT_PATH / Path(r"assets/acc_no_waiver_swipe_assets")


def relative_to_assets(path: str) -> Path:
    return ASSETS_PATH / Path(path)


class AccNoWaiverSwipe(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.photoList = []
        self.loadWidgets(controller)
    
    def loadWidgets(self, controller):
        canvas = Canvas(
            self,
            bg = "#153246",
            height = 720,
            width = 1280,
            bd = 0,
            highlightthickness = 0,
            relief = "ridge"
        )

        canvas.place(x = 0, y = 0)
        image_image_1 = PhotoImage(
            file=relative_to_assets("image_1.png"))
        
        self.photoList.append(image_image_1)
        
        image_1 = canvas.create_image(
            640.0,
            360.0,
            image=image_image_1
        )

        image_image_2 = PhotoImage(
            file=relative_to_assets("image_2.png"))
        
        self.photoList.append(image_image_2)
        
        image_2 = canvas.create_image(
            1042.0,
            359.0,
            image=image_image_2
        )

        image_image_3 = PhotoImage(
            file=relative_to_assets("image_3.png"))
        
        self.photoList.append(image_image_3)
        
        image_3 = canvas.create_image(
            408.0,
            76.0,
            image=image_image_3
        )

        image_image_4 = PhotoImage(
            file=relative_to_assets("image_4.png"))
        
        self.photoList.append(image_image_4)
        
        image_4 = canvas.create_image(
            408.0,
            429.0,
            image=image_image_4
        )

        button_image_1 = PhotoImage(
            file=relative_to_assets("button_1.png"))
        
        self.photoList.append(button_image_1)
        
        self.button_1 = Button(
            self,
            image=button_image_1,
            borderwidth=0,
            highlightthickness=0,
            command=lambda: controller.show_frame(MainPage),
            relief="flat"
        )
        self.button_1.place(
            x=875.0,
            y=581.0,
            width=344.0,
            height=71.0
        )

        canvas.create_text(
            37.0,
            45.0,
            anchor="nw",
            text="Account Status:",
            fill="#F5F0E6",
            font=("Montserrat", 40 * -1)
        )

        canvas.create_text(
            442.0,
            45.0,
            anchor="nw",
            text="Waiver Status:",
            fill="#F5F0E6",
            font=("Montserrat", 40 * -1)
        )

        image_image_5 = PhotoImage(
            file=relative_to_assets("image_5.png"))
        
        self.photoList.append(image_image_5)
        
        image_5 = canvas.create_image(
            372.0,
            52.0,
            image=image_image_5
        )

        image_image_6 = PhotoImage(
            file=relative_to_assets("image_6.png"))
        
        self.photoList.append(image_image_6)
        
        image_6 = canvas.create_image(
            730.0,
            52.0,
            image=image_image_6
        )

        image_image_7 = PhotoImage(
            file=relative_to_assets("image_7.png"))
        
        self.photoList.append(image_image_7)
        
        image_7 = canvas.create_image(
            1042.0,
            328.0,
            image=image_image_7
        )

        canvas.create_text(
            78.0,
            219.0,
            anchor="nw",
            text="Please scan the QR code\non the right and the our waiver",
            fill="#F5F0E6",
            font=("Montserrat", 48 * -1)
        )