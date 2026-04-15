# Scripps Sandbox Front Desk Pi Setup / Recovery

This document covers how to rebuild the Scripps Sandbox front desk Raspberry Pi if the device fails or needs to be replaced.

This repo contains the application code and most software dependencies. Sensitive credentials and tokens are **not** stored in Git and must be restored separately.

## What this Pi does

- runs the Sandbox front desk / check-in app
- looks up Sandbox users and waivers
- shows upcoming public-facing Sandbox reservations from Google Calendar

## What is in Git

This repository includes:

- front desk application code
- Python dependencies in `requirements.txt`
- the calendar fetcher script in `src/sandbox_calendar.py`
- the front screen UI in `src/MainPage.py`

## What is **not** in Git

These items must be restored from 1Password or another secure source:

- `src/creds.json`
  - service account credential for Sandbox users / waivers lookups
- `src/calendar_creds.json`
  - OAuth desktop credential for Google Calendar access
- `fabtoken.txt`
  - Fabman token, if still used by this setup

These files are local-only and can be recreated:

- `src/token.json`
  - generated after Google Calendar authorization
- `src/upcoming_events.json`
  - generated cache of upcoming events

## Before you start

You will need:

- a new Raspberry Pi with Raspberry Pi OS installed
- network access
- access to the `sandbox` user account, or whatever account will run the kiosk
- access to the credentials stored in 1Password
- access to the GitHub repo:
  - `https://github.com/ScriptsSandbox/Check-In`

## 1. Base Raspberry Pi setup

Boot the Pi, connect it to the network, and update the system:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y python3-venv git
```

If SSH is needed, enable it as part of your normal Pi setup.

## 2. Clone the repo

```bash
cd ~
git clone https://github.com/ScriptsSandbox/Check-In.git
cd Check-In
```

## 3. Create the virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 4. Install Python dependencies

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## 5. Restore secret files from 1Password

Restore these files into the repo:

```text
~/Check-In/src/creds.json
~/Check-In/src/calendar_creds.json
~/Check-In/fabtoken.txt
```

Notes:

- `src/creds.json` is the existing service account credential used for users / waivers
- `src/calendar_creds.json` is the Google OAuth desktop credential used for reading the Sandbox Staff Calendar
- do **not** overwrite one with the other

## 6. Generate the Google Calendar token

Run the calendar fetcher once:

```bash
cd ~/Check-In
source .venv/bin/activate
python src/sandbox_calendar.py
```

This should open a Google authorization flow in the browser.

After successful auth, it should create:

```text
~/Check-In/src/token.json
~/Check-In/src/upcoming_events.json
```

You can verify the cache file with:

```bash
cat ~/Check-In/src/upcoming_events.json
```

## 7. Set up automatic calendar refresh

Add this cron job for the `sandbox_calendar.py` refresh:

```cron
*/5 * * * * cd /home/sandbox/Check-In && /home/sandbox/Check-In/.venv/bin/python src/sandbox_calendar.py >> /home/sandbox/Check-In/calendar_refresh.log 2>&1
```

To edit crontab:

```bash
crontab -e
```

To verify:

```bash
crontab -l
```

## 8. Launch the app manually

```bash
cd ~/Check-In/src
source ../.venv/bin/activate
./run
```

## 9. Confirm the kiosk works

Check the following:

- the main front desk screen loads
- QR flow works
- No ID button works
- users / waivers lookup works
- upcoming events card appears
- upcoming events are being pulled from Google Calendar

To manually refresh the calendar cache:

```bash
cd ~/Check-In
source .venv/bin/activate
python src/sandbox_calendar.py
```

## 10. Restore auto-start behavior

If the kiosk is supposed to launch automatically on boot, restore whatever startup method is being used on the current Pi.

This may be one of:

- LXDE / desktop autostart
- a systemd service
- a cron `@reboot` job
- another local startup script

Document the current method on the live Pi and copy it here when confirmed.

## 11. Useful troubleshooting

### Problem: `ModuleNotFoundError` for a package like `gspread` or `googleapiclient`

Usually this means you are not running inside the virtual environment.

Use:

```bash
cd ~/Check-In
source .venv/bin/activate
```

Then rerun the command.

### Problem: `Client secrets must be for a web or installed app`

This means the calendar script is pointing at the wrong credential file.

- `src/creds.json` is a service account credential
- `src/calendar_creds.json` must be an OAuth desktop app credential

### Problem: front screen is not updating from the calendar

The front screen reads `src/upcoming_events.json`, not Google Calendar directly.

Check:

1. whether `src/sandbox_calendar.py` is running successfully
2. whether cron is installed and active
3. whether `src/upcoming_events.json` has a recent `generated_at` timestamp

### Problem: Google Calendar auth needs to be redone

Delete the generated token and rerun the calendar script:

```bash
rm ~/Check-In/src/token.json
cd ~/Check-In
source .venv/bin/activate
python src/sandbox_calendar.py
```

## 12. Recovery checklist

- [ ] Pi boots and connects to network
- [ ] repo cloned to `~/Check-In`
- [ ] virtual environment created
- [ ] requirements installed
- [ ] `src/creds.json` restored
- [ ] `src/calendar_creds.json` restored
- [ ] `fabtoken.txt` restored if needed
- [ ] `src/token.json` regenerated
- [ ] `src/upcoming_events.json` generated
- [ ] cron job installed
- [ ] app launches
- [ ] front desk screen works
- [ ] calendar events appear
- [ ] auto-start on boot restored

## Related secure note

See the 1Password secure note:

**Sandbox Front Desk Pi Recovery**

That note should contain:

- secret files / credentials
- file placement notes
- any tokens or account details that should not live in Git
