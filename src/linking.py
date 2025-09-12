from tkinter import Frame, Label, Entry, Button, StringVar
import tkinter as tk
import logging
import datetime
import time
import global_
from utils import utils
from UserWelcome import UserWelcome


def now_iso():
    return datetime.datetime.utcnow().isoformat()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def finish_checkin(name: str):
    """Log a normal check-in event and show the welcome screen."""
    util = utils()
    new_row = [
        util.getDatetime(),
        int(time.time()),
        name,
        str(global_.rfid),
        "User Checkin",
        "",
        "",
        "",
    ]
    try:
        global_.sheets.get_activity_db().append_row(new_row)
    except Exception:
        logging.warning("Failed to append check-in activity", exc_info=True)
    global_.traffic_light.set_green()
    global_.app.get_frame(UserWelcome).displayName(name)
    global_.app.show_frame(UserWelcome)


class UnlinkedCard(Frame):
    """Screen shown when a card UUID is not linked to any account."""

    def __init__(self, parent, controller):
        super().__init__(parent)
        self.controller = controller
        Label(self, text="No account linked to this card", font=("Inter", 40), fg="#F5F0E6", bg="#153246").pack(pady=40)
        btn_frame = tk.Frame(self, bg="#153246")
        btn_frame.pack(pady=20)
        Button(
            btn_frame,
            text="I already have an account →",
            font=("Inter", 24),
            command=lambda: self._goto_lookup("relink"),
        ).pack(pady=10)
        Button(
            btn_frame,
            text="I'm new →",
            font=("Inter", 24),
            command=lambda: self._goto_lookup("new"),
        ).pack(pady=10)
        self.configure(bg="#153246")

    def _goto_lookup(self, mode):
        frame = self.controller.get_frame(EmailLookup)
        frame.setup(mode, global_.rfid)
        self.controller.show_frame(EmailLookup)


class EmailLookup(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.controller = controller
        self.mode = "relink"
        self.card_uuid = ""
        self.email_var = StringVar()
        self.error_var = StringVar()
        Label(
            self,
            text="Forgot your card? Enter your UCSD email to continue.",
            font=("Inter", 32),
            fg="#F5F0E6",
            bg="#153246",
        ).pack(pady=20)
        entry = Entry(self, textvariable=self.email_var, width=40, font=("Inter", 24))
        entry.pack()
        entry.focus_set()
        Label(self, textvariable=self.error_var, fg="red", bg="#153246", font=("Inter", 20)).pack(pady=10)
        btns = tk.Frame(self, bg="#153246")
        btns.pack(pady=20)
        Button(btns, text="Submit", font=("Inter", 24), command=self.on_submit).pack(side="left", padx=10)
        Button(btns, text="Back", font=("Inter", 24), command=lambda: controller.show_frame(UnlinkedCard)).pack(side="left", padx=10)
        self.configure(bg="#153246")

    def setup(self, mode, card_uuid):
        self.mode = mode
        self.card_uuid = card_uuid
        self.email_var.set("")
        self.error_var.set("")

    def on_submit(self):
        email = normalize_email(self.email_var.get())
        if not email.endswith("@ucsd.edu"):
            self.error_var.set("Use your UCSD email.")
            return
        sm = global_.sheets
        try:
            users = sm.get_user_by_email(email)
        except Exception:
            self.error_var.set("We're having trouble linking right now. Please try again or see staff.")
            return
        if isinstance(users, list) and len(users) > 1:
            self.error_var.set("We found more than one account for that email. Please see staff.")
            return
        user = users[0] if isinstance(users, list) else users
        if user:
            old_uuid = user.get("card_uuid")
            try:
                sm.update_user_card_uuid(email, self.card_uuid)
                sm.append_activity(
                    {
                        "ts": now_iso(),
                        "event": "update_card_uuid",
                        "email": email,
                        "old_card_uuid": old_uuid,
                        "new_card_uuid": self.card_uuid,
                    }
                )
            except Exception:
                self.error_var.set("We're having trouble linking right now. Please try again or see staff.")
                return
            name = user.get("first_name") or user.get("Name") or ""
            finish_checkin(name)
            return
        waiver = sm.get_waiver_by_email(email)
        if waiver:
            user_row = {
                "email": email,
                "pid": waiver.get("pid") or waiver.get("A_Number"),
                "first_name": waiver.get("first_name") or waiver.get("First_Name"),
                "last_name": waiver.get("last_name") or waiver.get("Last_Name"),
                "card_uuid": self.card_uuid,
                "waiver_status": "verified" if waiver.get("signed_at") or waiver.get("Timestamp") else "pending",
            }
            try:
                sm.insert_user(user_row)
                sm.append_activity(
                    {
                        "ts": now_iso(),
                        "event": "create_user_from_waiver",
                        "email": email,
                        "new_card_uuid": self.card_uuid,
                    }
                )
            except Exception:
                self.error_var.set("We're having trouble linking right now. Please try again or see staff.")
                return
            name = user_row.get("first_name", "")
            finish_checkin(name)
            return
        # No waiver match
        frame = self.controller.get_frame(MinimalInfo)
        frame.setup(email, self.card_uuid)
        self.controller.show_frame(MinimalInfo)


class MinimalInfo(Frame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.controller = controller
        self.email = ""
        self.card_uuid = ""
        self.last_name_var = StringVar()
        self.pid_var = StringVar()
        self.error_var = StringVar()
        Label(self, text="Enter basics", font=("Inter", 32), fg="#F5F0E6", bg="#153246").pack(pady=20)
        Label(self, textvariable=tk.StringVar(value="Email"), font=("Inter",24), fg="#F5F0E6", bg="#153246").pack()
        self.email_label = Label(self, font=("Inter",24), fg="#F5F0E6", bg="#153246")
        self.email_label.pack()
        Label(self, text="Last Name", font=("Inter",24), fg="#F5F0E6", bg="#153246").pack(pady=(20,0))
        Entry(self, textvariable=self.last_name_var, width=30, font=("Inter",24)).pack()
        Label(self, text="PID", font=("Inter",24), fg="#F5F0E6", bg="#153246").pack(pady=(20,0))
        Entry(self, textvariable=self.pid_var, width=30, font=("Inter",24)).pack()
        Label(self, textvariable=self.error_var, fg="red", bg="#153246", font=("Inter",20)).pack(pady=10)
        btns = tk.Frame(self, bg="#153246")
        btns.pack(pady=20)
        Button(btns, text="Submit", font=("Inter",24), command=self.on_submit).pack(side="left", padx=10)
        Button(btns, text="Back", font=("Inter",24), command=lambda: controller.show_frame(UnlinkedCard)).pack(side="left", padx=10)
        self.configure(bg="#153246")

    def setup(self, email, card_uuid):
        self.email = email
        self.card_uuid = card_uuid
        self.last_name_var.set("")
        self.pid_var.set("")
        self.error_var.set("")
        self.email_label.configure(text=email)

    def on_submit(self):
        last_name = self.last_name_var.get().strip()
        pid = self.pid_var.get().strip()
        if not last_name or not pid:
            self.error_var.set("Please complete all fields.")
            return
        sm = global_.sheets
        user_row = {
            "email": self.email,
            "pid": pid,
            "last_name": last_name,
            "card_uuid": self.card_uuid,
            "waiver_status": "pending",
        }
        try:
            sm.insert_user(user_row)
            sm.append_activity(
                {
                    "ts": now_iso(),
                    "event": "create_user_minimal",
                    "email": self.email,
                    "new_card_uuid": self.card_uuid,
                }
            )
        except Exception:
            self.error_var.set("We're having trouble linking right now. Please try again or see staff.")
            return
        finish_checkin(last_name)
