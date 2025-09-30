from tkinter import *
from gui import *
from swipe import *
from reader import *
from fabman import *
from sheets import *
from threading import Thread
from UserWelcome import *
from ManualFill import *
from CheckInNoId import *
import global_
import socket
import logging
import argparse
import serial.tools.list_ports as list_ports

TRAFFIC_LIGHT_VID = 6790
READER_VID = 4292


def is_connected(host="8.8.8.8", port=53, timeout=3):
    """
    Host: 8.8.8.8 (google-public-dns-a.google.com)
    OpenPort: 53/tcp
    Service: domain (DNS/TCP)
    """
    try:
        socket.setdefaulttimeout(timeout)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect((host, port))
        return True
    except socket.error as ex:
        return False


##############################################################
# This acts as the main loop of the program, ran in a thread #
##############################################################

no_wifi_shown = False


def myLoop(app, reader):
    global no_wifi_shown, no_wifi
    logging.info("Now reading ID cards")
    last_tag = 0
    last_time = 0
    while True:
        time.sleep(0.1)
        in_waiting = reader.getSerInWaiting()
        tag = 0

        if in_waiting >= 14:
            if not is_connected():
                logging.info("ERROR wifi is not connected")
                if not no_wifi_shown:
                    no_wifi_shown = True
                    no_wifi = Label(
                        app.get_frame(MainPage),
                        text="ERROR! Connection cannot be established, please let staff know.",
                        font=("Inter", 25 * -1),
                    )
                    no_wifi.pack(pady=40)
                    no_wifi.after(4000, lambda: destroyNoWifiError(no_wifi))
                continue

            app.get_frame(ManualFill).clearEntries()
            tag = reader.grabRFID()

            if " " in tag:
                continue

            if tag == last_tag and not reader.canScanAgain(last_time):
                logging.debug("Suppressing repeat scan")
                continue

            s_reason = reader.checkRFID(tag)

            if s_reason != "good":
                logging.debug(s_reason)
                continue
            else:
                logging.debug("RFID Check Succeeded")

            global_.setRFID(tag)

            # Get a list of all users
            user_data = global_.sheets.get_user_db_data()

            # Get a list of all waiver signatures
            waiver_data = global_.sheets.get_waiver_db_data()

            curr_user = "None"
            curr_user_w = "None"

            for i in user_data:
                if i["Card UUID"] == tag:
                    curr_user = i

            if curr_user != "None":
                for i in waiver_data:
                    waiver_id = i["A_Number"].lower()
                    waiver_email = i["Email"].lower()
                    user_id = curr_user["Student ID"].lower()
                    user_email = curr_user["Email Address"].lower()

                    user_id = user_id.replace("+e?", "")[:9]
                    waiver_id = waiver_id.replace("+e?", "")[:9]

                    if user_id[0] == "a":
                        user_id = user_id[1:]

                    if waiver_id[0] == "a":
                        waiver_id = waiver_id[1:]

                    if user_id == waiver_id or user_email == waiver_email:
                        curr_user_w = i

            ############################
            # All scenarios for ID tap #
            ############################

            if curr_user == "None" and curr_user_w == "None":
                logging.info("User was not found in the database")
                global_.traffic_light.set_red()
                app.show_frame(NoAccNoWaiverSwipe)
            elif curr_user_w == "None":
                logging.info("User does not have waiver")
                global_.traffic_light.set_yellow()
                app.show_frame(AccNoWaiver)
                app.after(3000, lambda: app.show_frame(AccNoWaiverSwipe))
            elif curr_user == "None":
                logging.info("User has a waiver but no account")
                app.show_frame(WaiverNoAcc)
                app.after(3000, lambda: app.show_frame(WaiverNoAccSwipe))
            else:
                new_row = [
                    util.getDatetime(),
                    int(time.time()),
                    curr_user["Name"],
                    str(tag),
                    "User Checkin",
                    "",
                    "",
                    "",
                ]
                activity_log = global_.sheets.get_activity_db()
                activity_log.append_row(new_row)
                global_.traffic_light.set_green()
                global_.app.get_frame(UserWelcome).displayName(curr_user["Name"])

            last_time = time.time()
            last_tag = tag

            reader.readSerial()


def destroyNoWifiError(no_wifi):
    global no_wifi_shown
    no_wifi.destroy()
    no_wifi_shown = False


def clearAndReturn():
    global_.traffic_light.set_off()
    global_.app.show_frame(MainPage)
    global_.app.get_frame(ManualFill).clearEntries()
    global_.app.get_frame(CheckInNoId).clearEntries()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Makerspace Check-in System",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Increase verbosity (print debug info)",
    )

    args = parser.parse_args()
    config = vars(args)

    if config["verbose"]:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    ports = list(serial.tools.list_ports.comports())
    reader_usb_id = None
    traffic_usb_id = None

    for p in ports:
        if p.vid == READER_VID:
            reader_usb_id = p.device
        elif p.vid == TRAFFIC_LIGHT_VID:
            traffic_usb_id = p.device

    global_.init(traffic_usb_id)
    app = gui()
    global_.setApp(app)
    global_.traffic_light.set_off()
    sw = swipe()
    reader = Reader(reader_usb_id)
    util = utils()
    thread = Thread(target=myLoop, args=(app, reader))
    logging.info("Starting thread")
    thread.start()
    app.bind("<Key>", lambda i: sw.keyboardPress(i))
    app.bind("<Escape>", lambda i: clearAndReturn())
    logging.info("Made it to app start")
    app.start()
