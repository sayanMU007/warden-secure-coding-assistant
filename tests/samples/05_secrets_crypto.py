import hashlib
import requests

API_KEY = "warden-demo-api-key-7f3a9c1e5b2d48a6"
DB_PASSWORD = "SuperSecretPassw0rd!"


def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()


def charge(amount_cents, token):
    resp = requests.post(
        "https://api.payments.example.com/v1/charges",
        headers={"Authorization": "Bearer " + API_KEY},
        data={"amount": amount_cents, "source": token},
    )
    return resp.json()
