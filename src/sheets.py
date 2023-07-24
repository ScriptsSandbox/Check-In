import gspread
import os.path
from gspread_formatting import *
from oauth2client.service_account import ServiceAccountCredentials



class sheets:
    def __init__(self):
        try:
            self.connectSheet()
        except:
            print("gspread was unable to connect")
                    
    def connectSheet(self):
        #global user_db, w_db, a_log
        scope = [
            "https://spreadsheets.google.com/feeds",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive",
        ]
        #TODO: This file path needs to be changed
        os.chdir("/home/makeradmin/checkin_logan/")
        creds = ServiceAccountCredentials.from_json_keyfile_name(
            os.path.abspath("creds.json"), scope
        )
        client = gspread.authorize(creds)
        user_db = client.open("User Database").sheet1  # Open the spreadhseet
        print("User Database Loaded")
        a_log = client.open_by_url(
            "https://docs.google.com/spreadsheets/d/1aLBb1J2ifoUG2UAxHHbwxNO3KrIIWoI0pnZ14c5rpOM/edit?usp=drive_web&ouid=104398832910104737872"
        ).sheet1
        print("Activity Log Loaded")
        w_db = client.open("Waiver Signatures").sheet1
        print("Waiver Database Loaded")
