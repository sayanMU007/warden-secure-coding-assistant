import sqlite3
from flask import Flask, request, jsonify
from werkzeug.security import check_password_hash

app = Flask(__name__)


def get_db():
    return sqlite3.connect("users.db")


@app.route("/login", methods=["POST"])
def login():
    username = request.form.get("username", "")
    password = request.form.get("password", "")
    row = get_db().execute(
        "SELECT id, role, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row and check_password_hash(row[2], password):
        return jsonify({"id": row[0], "role": row[1]})
    return jsonify({"error": "invalid credentials"}), 401
