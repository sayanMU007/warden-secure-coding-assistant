import os
from flask import Flask, request

app = Flask(__name__)


@app.route("/ping")
def ping():
    host = request.args.get("host", "127.0.0.1")
    result = os.popen("ping -c 1 " + host).read()
    return "<pre>" + result + "</pre>"


@app.route("/health")
def health():
    return "ok"
