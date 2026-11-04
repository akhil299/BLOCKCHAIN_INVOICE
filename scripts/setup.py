#!/usr/bin/env python3
"""InvoChain one-time setup (works on Windows, macOS and Linux).

    python scripts/setup.py

What it does:
  1. checks that Node.js, npm, Python and Tesseract are installed (and tells you how to fix anything missing)
  2. creates a ready-to-use `.env` for the LOCAL test chain (random secrets, no real keys)
  3. installs the contracts, backend and frontend dependencies
"""
import os
import secrets
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IS_WIN = os.name == "nt"

# Hardhat's built-in PUBLIC test account #0. Safe ONLY for the local fake blockchain. Never use on a real network.
LOCAL_ADMIN_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
LOCAL_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"


def say(msg=""):
    print(msg, flush=True)


def step(n, msg):
    say(f"\n[{n}] {msg}")


def run(cmd, cwd, env=None):
    exe = shutil.which(cmd[0]) or cmd[0]
    return subprocess.run([exe, *cmd[1:]], cwd=cwd, env=env).returncode


def check_tools() -> bool:
    ok = True
    problems = []
    node = shutil.which("node")
    if not node:
        ok = False
        problems.append("Node.js is missing. Install the LTS version from https://nodejs.org then reopen this terminal.")
    else:
        major = int(subprocess.check_output([node, "-v"], text=True).strip().lstrip("v").split(".")[0])
        if major < 18:
            ok = False
            problems.append(f"Node.js {major} is too old. Install version 20 or newer from https://nodejs.org")
    if sys.version_info < (3, 10):
        ok = False
        problems.append("Python 3.10 or newer is required. Get it from https://www.python.org/downloads/")
    if not shutil.which("tesseract"):
        problems.append(
            "Tesseract (the invoice text reader) was not found. The app still starts, but uploading invoices will fail until you install it:\n"
            "      Windows: https://github.com/UB-Mannheim/tesseract/wiki  (tick 'add to PATH' or add it manually)\n"
            "      Mac:     brew install tesseract\n"
            "      Ubuntu:  sudo apt install tesseract-ocr")
    for p in problems:
        say("  ! " + p)
    if not problems:
        say("  OK: Node.js, Python and Tesseract are all installed.")
    return ok


def write_env():
    target = ROOT / ".env"
    if target.exists():
        say("  .env already exists, leaving it untouched.")
        return
    text = (ROOT / ".env.example").read_text()

    def setv(key, value):
        nonlocal text
        lines = text.splitlines()
        for i, ln in enumerate(lines):
            if ln.startswith(key + "="):
                lines[i] = f"{key}={value}"
                break
        else:
            lines.append(f"{key}={value}")
        text = "\n".join(lines) + "\n"

    setv("JWT_SECRET", secrets.token_urlsafe(48))
    setv("ENCRYPTION_MASTER_KEY", secrets.token_urlsafe(48))
    setv("MONGO_URI", "mock")  # in-memory database: nothing to install. Resets when you stop the app.
    setv("RPC_URL", "http://127.0.0.1:8545")
    setv("CHAIN_ID", "31337")
    setv("OPERATOR_PRIVATE_KEY", LOCAL_ADMIN_KEY)
    setv("OPERATOR_ADDRESS", LOCAL_ADMIN_ADDRESS)
    setv("ADMIN_WALLETS", LOCAL_ADMIN_ADDRESS)
    setv("IPFS_MODE", "mock")
    target.write_text(text)
    say("  Created .env for the LOCAL test blockchain (random secrets generated).")


def solc_reachable() -> bool:
    try:
        urllib.request.urlopen("https://binaries.soliditylang.org/linux-amd64/list.json", timeout=6)
        return True
    except Exception:
        return False


def main() -> int:
    say("=== InvoChain setup ===")
    step(1, "Checking your tools")
    if not check_tools():
        say("\nFix the items marked with ! above, then run this script again.")
        return 1

    step(2, "Creating your configuration file (.env)")
    write_env()

    step(3, "Installing the smart-contract tools (1-3 minutes)")
    if run(["npm", "install", "--legacy-peer-deps", "--no-audit", "--no-fund"], ROOT / "contracts") != 0:
        say("  ! npm install failed for contracts. Check your internet connection and retry.")
        return 1

    step(4, "Installing the backend (Python) packages (2-5 minutes)")
    venv = ROOT / "backend" / ".venv"
    if not venv.exists():
        if run([sys.executable, "-m", "venv", str(venv)], ROOT / "backend") != 0:
            say("  ! Could not create the Python virtual environment.")
            return 1
    py = venv / ("Scripts/python.exe" if IS_WIN else "bin/python")
    if run([str(py), "-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", "requirements.txt"], ROOT / "backend") != 0:
        say("  ! pip install failed. Read the error above (often a missing build tool or no internet).")
        return 1

    step(5, "Installing the website (frontend) packages (1-2 minutes)")
    if run(["npm", "install", "--legacy-peer-deps", "--no-audit", "--no-fund"], ROOT / "frontend") != 0:
        say("  ! npm install failed for the frontend.")
        return 1

    step(6, "Checking the Solidity compiler download")
    if solc_reachable():
        say("  OK: normal compiler download works.")
    else:
        say("  The official compiler host is blocked on this network. The start script will use the built-in compiler instead (slower, but works).")
        (ROOT / "scripts" / ".use_solcjs").write_text("1")

    say("\nSetup finished.\nNext: python scripts/start_local.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
