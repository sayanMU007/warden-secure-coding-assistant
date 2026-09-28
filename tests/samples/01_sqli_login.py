import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)


def get_db():
    return sqlite3.connect("users.db")


@app.route("/login", methods=["POST"])
def login():
    username = request.form["username"]
    password = request.form["password"]
    db = get_db()
    query = "SELECT id, role FROM users WHERE username = '" + username + "' AND password = '" + password + "'"
    row = db.execute(query).fetchone()
    if row:
        return jsonify({"id": row[0], "role": row[1]})
    return jsonify({"error": "invalid credentials"}), 401
