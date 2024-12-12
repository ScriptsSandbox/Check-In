import requests
import logging
import datetime

fab_file = open("fabtoken.txt", "r")
fabman_key = fab_file.readline()[:-1]
base_url = "https://fabman.io/api/v1"
fabman_space = 2628
fabman_account = 1046
fabman_DIBUser = 9464


class fabman:
    def __init__(self) -> None:
        pass

    def createFabmanAccount(self, firstName, lastName, emailAddress, RFIDtag):
        emailAddress = emailAddress.lower()
        member_data = {
            "firstName": f"{firstName}",
            "lastName": f"{lastName}",
            "emailAddress": f"{emailAddress}",
            "space": fabman_space,
            "account": fabman_account,
        }

        member_key = {"token": f"{RFIDtag}", "type": "nfca"}
        today_date = datetime.datetime.now().strftime("%Y-%m-%d")
        member_packages = {"package": f"{fabman_DIBUser}", "fromDate": f"{today_date}"}
        params = {"q": f"{emailAddress}"}
        headers = {"Authorization": f"Bearer {fabman_key}"}

        attempt_member = requests.post(
            f"{base_url}/members", headers=headers, json=member_data
        )
        get_member_id = requests.get(
            f"{base_url}/members", headers=headers, params=params
        )
        member_id = get_member_id.json()

        if attempt_member.status_code == requests.codes.created:
            logging.info(f"Account has been created for {firstName}")
        elif member_id and get_member_id.status_code == requests.codes.ok:
            logging.info(f"{emailAddress} already had account. Using old account.")
        else:
            logging.warning(f"Account creation failed: {attempt_member.status_code}\n")
            logging.info(attempt_member.json())
            return

        actual_id = [user["id"] for user in member_id]

        add_package = requests.post(
            f"{base_url}/members/{actual_id[0]}/packages",
            headers=headers,
            json=member_packages,
        )
        attempt_key = requests.post(
            f"{base_url}/members/{actual_id[0]}/key", headers=headers, json=member_key
        )

        if add_package.status_code == requests.codes.created:
            logging.info(f"Package ({fabman_DIBUser}) has been added for {firstName}")
        else:
            logging.warning(f"Package add failed: {attempt_member.status_code}")
            logging.info(add_package.json())

        if attempt_key.status_code == requests.codes.created:
            logging.info(f"Key ({RFIDtag}) has been assigned to {firstName}")
        else:
            logging.warning(f"Key assignment failed: {attempt_member.status_code}")
            logging.info(attempt_key.json())
