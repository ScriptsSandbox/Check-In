
# Part of this file was generated by the Tkinter Designer by Parth Jadhav
# https://github.com/ParthJadhav/Tkinter-Designer


from pathlib import Path

# from tkinter import *
# Explicit imports to satisfy Flake8
from tkinter import *


OUTPUT_PATH = Path(__file__).parent
ASSETS_PATH = OUTPUT_PATH / Path(r"assets\user_thank_assets")


def relative_to_assets(path: str) -> Path:
    return ASSETS_PATH / Path(path)


class UserThank(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.photoList = []
        self.loadWidgets()
        
    def loadWidgets(self):  
        canvas = Canvas(
            self,
            bg = "#153244",
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
            639.33203125,
            359.333984375,
            image=image_image_2
        )

        canvas.create_text(
            99.33203125,
            259.33203125,
            anchor="nw",
            text="Thank you for registering",
            fill="#F5F0E6",
            font=("Montserrat", 45 * -1)
        )

        canvas.create_text(
            429.0,
            550.0,
            anchor="nw",
            text="UCSD Makerspace",
            fill="#F5F0E6",
            font=("Montserrat", 45 * -1)
        )

        canvas.create_text(
            99.0,
            323.0,
            anchor="nw",
            text="First Name and Last Name",
            fill="#F5F0E6",
            font=("Montserrat", 73 * -1)
        )