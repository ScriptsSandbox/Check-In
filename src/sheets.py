import time
import gspread
import os
import logging
from oauth2client.service_account import ServiceAccountCredentials


class Sheet:
    CACHE_TIME = 60 * 30

    def __init__(self, db):
        self.db = db
        self.data = None
        self.last_updated = time.time()

    def get_sheet(self):
        return self.db

    def get_data(self, force_update):
        curr_time = time.time()
        if (
            not self.data
            or force_update
            or curr_time - self.last_updated > self.CACHE_TIME
        ):
            try:
                logging.info("Updating database from web")
                self.data = self.db.get_all_records(numericise_ignore=["all"])
                self.last_updated = curr_time
            except Exception as e:
                logging.warning("Unable to update Google Sheets", exc_info=True)

        return self.data


class SheetManager:
    def __init__(self):
        scope = [
            "https://spreadsheets.google.com/feeds",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive",
        ]
        try:
            creds = ServiceAccountCredentials.from_json_keyfile_name(
                os.path.abspath("creds.json"), scope
            )
            client = gspread.authorize(creds)
            self.user_db = Sheet(
                client.open("User Database SIO").sheet1
            )  # Open the spreadhseet

            logging.info("User Database Loaded")
            self.activity_db = Sheet(
                client.open_by_url(
                    "https://docs.google.com/spreadsheets/d/1w--D-1_yhq9uTgcbClIEMo7Hon_wTiCtAbBbZRfCsyc/edit?gid=0#gid=0"
                ).sheet1
            )
            logging.info("Activity Database Loaded")
            self.waiver_db = Sheet(client.open("Waiver Signatures SIO").sheet1)
            logging.info("Waiver Database Loaded")
        except Exception as e:
            logging.warning(
                "An ERROR has ocurred connecting to google sheets", exc_info=True
            )
            raise Exception("Failed to connect to Google Sheets... check the wifi?")

    def get_user_db(self):
        return self.user_db.get_sheet()

    def get_activity_db(self):
        return self.activity_db.get_sheet()

    def get_waiver_db(self):
        return self.waiver_db.get_sheet()

    def get_user_db_data(self, force_update=False):
        return self.user_db.get_data(force_update)

    def get_activity_db_data(self, force_update=False):
        return self.activity_db.get_data(force_update)

    def get_waiver_db_data(self, force_update=False):
        return self.waiver_db.get_data(force_update)

    # ------------------------------------------------------------------
    # Helper methods for Option A linking workflow
    # ------------------------------------------------------------------

    def _user_header(self):
        return [h.strip() for h in self.get_user_db().row_values(1)]

    def get_user_by_card_uuid(self, card_uuid):
        data = self.get_user_db_data()
        for row in data:
            if str(row.get("card_uuid") or row.get("Card UUID")) == card_uuid:
                return row
        return None

    def get_user_by_email(self, email):
        data = self.get_user_db_data()
        matches = [
            r
            for r in data
            if (r.get("email") or r.get("Email Address", "")).strip().lower() == email
        ]
        return matches if len(matches) > 1 else (matches[0] if matches else None)

    def update_user_card_uuid(self, email, new_uuid):
        sheet = self.get_user_db()
        header = self._user_header()
        email_col = (
            header.index("email") + 1 if "email" in header else header.index("Email Address") + 1
        )
        uuid_col = (
            header.index("card_uuid") + 1 if "card_uuid" in header else header.index("Card UUID") + 1
        )
        updated_col = header.index("updated_at") + 1 if "updated_at" in header else None
        cell = sheet.find(email)
        sheet.update_cell(cell.row, uuid_col, new_uuid)
        if updated_col:
            from datetime import datetime

            sheet.update_cell(cell.row, updated_col, datetime.utcnow().isoformat())

    def get_waiver_by_email(self, email):
        data = self.get_waiver_db_data()
        for row in data:
            if (row.get("email") or row.get("Email", "")).strip().lower() == email:
                return row
        return None

    def insert_user(self, user_row):
        from datetime import datetime

        sheet = self.get_user_db()
        header = self._user_header()
        now = datetime.utcnow().isoformat()
        user_row.setdefault("created_at", now)
        user_row.setdefault("updated_at", now)
        row = [user_row.get(h, "") for h in header]
        sheet.append_row(row)
        self.get_user_db_data(force_update=True)

    def append_activity(self, activity_row):
        sheet = self.get_activity_db()
        header = [h.strip() for h in sheet.row_values(1)]
        row = [activity_row.get(h, "") for h in header]
        sheet.append_row(row)
