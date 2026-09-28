import base64
import pickle
from flask import Flask, request

app = Flask(__name__)


@app.route("/restore-session", methods=["POST"])
def restore_session():
    blob = request.form["session"]
    session = pickle.loads(base64.b64decode(blob))
    return "Welcome back, " + session.get("name", "guest")
