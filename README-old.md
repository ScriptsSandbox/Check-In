# UCSD Makerspace Check-In System

Welcome to the UCSD Makerspace.  
This repository contains the code for the RFID-based check-in station deployed at the makerspace. Students check in by tapping their UCSD ID at the station, which verifies their account and waiver status and logs their activity.

## How it Works

The check-in station is a Python-based application with a main event loop running on its own thread. It integrates with several components to verify and log student check-ins:

- **Traffic Light**: A USB-connected device that shows green, yellow, or red lights indicating the check-in status.
- **Local User Database**: A cached JSON file storing known student records for quick lookup.
- **Online User Database**: The authoritative source of student records, accessed via Google Sheets.
- **Online Waiver Database**: A separate Google Sheet tracking which students have signed the required waiver.

### 1. Card Scan
The student taps their UCSD ID, and the RFID tag is read and queried to our local database.

### 2. Determine Student Status
- If the student **is found locally**:
  - If waiver is already signed locally: mark check-in as successful, light turns green, and activity is logged.
  - If no waiver is marked locally: query the waiver database online.
    - If waiver is found online: update the local record and proceed as above.
    - If waiver is still not found: light turns yellow and a QR code for waiver signature is displayed.
  
- If the student **is not found locally**:
  - If the student is found online: add to the local database and follow the same waiver checks as above.
  - If the student is not found online: begin the **account creation workflow**.

### 3. Account Creation Workflow
If no account is found locally or online:
- The system displays a screen informing the student that no account exists (`NoAccNoWaiver.py`).
- After a short delay, the student is prompted (`NoAccNoWaiverSwipe.py`) to scan the barcode on their ID or to enter their information manually.
- If barcode scan fails, the student can use the manual fill form (`ManualFill.py`) to enter their name, PID, and email.
- Once submitted, a new account is created, added to both the local and online databases, provisioned in Fabman.io, and the student is checked in. A confirmation screen (`UserThank.py`) is then shown.

### 4. Log Activity
All successful check-ins are enqueued and written asynchronously to the Google Sheets activity log. This avoids delays from network or API latency and deduplicates repeated scans within a short time window.

## Status Indicators

| Color  | Meaning                   |
|--------|---------------------------|
| Green  | Check-in successful       |
| Yellow | Waiver not yet signed     |
| Red    | Account not found         |

## Features

### Waiver Management
Automatically verifies waiver status locally and online. Updates the local database when waiver is found online.

### Local and Online Sync
Uses a local JSON database for fast lookups. Refreshes records periodically or when missing information.

### Fabman.io Integration
Each machine in the makerspace is controlled by Fabman.io. Students are provisioned Fabman accounts and access tokens via the `fabman.py` API client after completing required trainings or attending mandatory workshops. Non-technical staff members are able to use our Google Sheets database to grant access to students via Google Sheets checkboxes (enabled by Google Sheets scripts).

### Asynchronous Logging Queue
All check-ins are enqueued and written asynchronously to the Google Sheets activity log. This prevents blocking the main loop and deduplicates repeated scans within a short time window, ensuring smooth operation even with network latency.

### Error Handling
Displays errors and disables check-in if network connectivity or database access fails.

## Project Structure

This repository is organized into the following main components:

- `main.py`  
  Application entry point. Initializes the RFID reader, traffic light, GUI, and starts the main loop thread.

- `core/handle_check_in.py`  
  Core check-in logic: verifies student account, waiver status, updates local database, and logs check-ins.

- `core/checkin_queue.py`  
  Implements an asynchronous queue for logging check-ins to Google Sheets, to avoid blocking the main thread.

- `core/UserRecord.py`
  Class with various information extraction methods, student verifications, and helper functions to assist handling a check-in.

- `core/new_row_check_in.py`  
  Handles activity logging and displaying the appropriate GUI status pages based on the check-in result.

- `utils.py`  
  Utility functions for validation, waiver matching, timestamp formatting, and account creation workflow.

- `fabman.py`  
  Client for interacting with the Fabman.io API to provision accounts and grant machine access.

- `gui/`  
  Tkinter-based user interface, including:
  - `AccNoWaiver.py`, `AccNoWaiverSwipe.py` – Pages for users missing a waiver
  - `NoAccNoWaiver.py`, `NoAccNoWaiverSwipe.py` – Pages for users with no account
  - `CheckInNoId.py` – Allows manual check-in with PID
  - `ManualFill.py` – Manual account creation form
  - `UserWelcome.py`, `UserThank.py` – Success confirmation pages
  - `traffic.py` – Controls the USB-connected traffic light

- `export_user_db.py`  
  Utility script to export the online student database to the local machine.

- `get_info_from_pid.py`  
  Queries UCSD APIs for student information by PID.

## Development

### Requirements
- Python 3.8 or higher
- Google Sheets API credentials (configured in `global_.sheets`)
- Fabman API token saved in `fabtoken.txt`

## Privacy and Credentials

This repository depends on several sensitive files and credentials that are **not included in version control** for privacy and security:

- `assets/local_user_db.json`  
  Contains the local cache of student records. This is generated automatically at runtime or by running `export_user_db.py` and should not be manually edited.

- `fabtoken.txt`  
  Contains the API token for Fabman.io. This file must be created manually on the deployment machine with your Fabman API key.

- Google Sheets API credentials  
  Managed separately via OAuth and stored securely on the deployment machine.

These files are excluded from the repository via `.gitignore` and must be provisioned when setting up a new check-in station.

### Running
First, make sure to install the required packages with `pip install -r requirements.txt` in the main directory

On a deployed machine, you can use the provided helper script to run the system and log output:

```bash
./run

# or:

python3 main.py [-v]