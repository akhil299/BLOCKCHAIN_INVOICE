#!/usr/bin/env python3
"""Starts the WHOLE InvoChain app on your computer with one command (Windows, macOS, Linux).

    python scripts/start_local.py

It starts: a fake local blockchain -> deploys the smart contracts -> the backend -> the website.
Press Ctrl+C once to stop everything. Everything resets when you stop (fake blockchain + in-memory database).
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IS_WIN = os.name == "nt"
LOGS = ROOT / "logs"
procs = []

# Hardhat's public test accounts #0-#3 (fake money, local chain only).
ACCOUNTS = [
    ("Admin     ", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
    ("Supplier  ", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
    ("Buyer     ", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"),
    ("Financier ", "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"),
]


def say(msg=""):
    print(msg, flush=True)


def fail(msg):
    say(f"\n  X {msg}")
    stop_all()
    sys.exit(1)


def exe(name):
    return shutil.which(name) or name


def spawn(name, cmd, cwd, env=None, show=False, logfile=None):
    full_env = {**os.environ, **(env or {})}
    kw = {}
    if IS_WIN:
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    p = subprocess.Popen([exe(cmd[0]), *cmd[1:]], cwd=cwd, env=full_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    procs.append(p)
    LOGS.mkdir(exist_ok=True)
    log = open(LOGS / (logfile or f"{name}.log"), "w", encoding="utf-8")

    def pump():
        for line in p.stdout:
            log.write(line)
            log.flush()
            if show:
                say(f"  [{name}] {line.rstrip()}")

    threading.Thread(target=pump, daemon=True).start()
    return p


def stop_all():
    for p in procs:
        if p.poll() is not None:
            continue
        try:
            if IS_WIN:
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
            else:
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
        except Exception:
            pass


def wait_for(url, what, seconds=90, post=None):
    end = time.time() + seconds
    while time.time() < end:
        try:
            req = urllib.request.Request(url, data=post, headers={"content-type": "application/json"} if post else {})
            urllib.request.urlopen(req, timeout=3).read()
            return True
        except Exception:
            time.sleep(1)
    return False


def _bye(*_):
    raise KeyboardInterrupt


def main():
    # Always clean up the background processes, even if Ctrl+C was ignored by the parent shell or the terminal is closed.
    for sig in ("SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"):
        if hasattr(signal, sig):
            try:
                signal.signal(getattr(signal, sig), _bye)
            except (ValueError, OSError):
                pass
    if not (ROOT / ".env").exists():
        fail("No .env file yet. Run the one-time setup first:  python scripts/setup.py")
    if not (ROOT / "contracts" / "node_modules").exists() or not (ROOT / "backend" / ".venv").exists() or not (ROOT / "frontend" / "node_modules").exists():
        fail("Dependencies are not installed yet. Run the one-time setup first:  python scripts/setup.py")
    venv_py = ROOT / "backend" / ".venv" / ("Scripts/python.exe" if IS_WIN else "bin/python")
    chain_env = {"USE_SOLCJS": "1"} if (ROOT / "scripts" / ".use_solcjs").exists() else {}
    deployment = ROOT / "shared" / "deployment.json"
    if deployment.exists():
        deployment.unlink()  # a fresh chain needs a fresh deployment

    say("=== Starting InvoChain (local test mode) ===")
    say("\n[1/4] Starting the local test blockchain...")
    spawn("chain", ["npx", "hardhat", "node"], ROOT / "contracts", chain_env)
    rpc = json.dumps({"jsonrpc": "2.0", "method": "eth_chainId", "id": 1}).encode()
    if not wait_for("http://127.0.0.1:8545", "chain", 180, rpc):
        fail("The local blockchain did not start. See logs/chain.log. (Is port 8545 already in use?)")
    say("      Blockchain is running.")

    say("[2/4] Deploying the smart contracts...")
    r = subprocess.run([exe("npx"), "hardhat", "run", "scripts/deploy.js", "--network", "localhost"], cwd=ROOT / "contracts",
                       env={**os.environ, **chain_env}, capture_output=True, text=True)
    (LOGS / "deploy.log").write_text(r.stdout + r.stderr, encoding="utf-8")
    if r.returncode != 0 or not deployment.exists():
        say(r.stdout[-1500:] + r.stderr[-1500:])
        fail("Deploying the contracts failed. Details above and in logs/deploy.log")
    say("      Contracts deployed.")

    say("[3/4] Starting the backend (server)...")
    spawn("api", [str(venv_py), "-m", "uvicorn", "app.main:app", "--port", "8000"], ROOT / "backend")
    if not wait_for("http://127.0.0.1:8000/api/health", "api", 90):
        fail("The backend did not start. See logs/api.log")
    health = json.loads(urllib.request.urlopen("http://127.0.0.1:8000/api/health").read())
    if not health["chain"].get("connected"):
        fail(f"Backend started but cannot talk to the blockchain: {health['chain'].get('error')}")
    say("      Backend is running and connected to the blockchain.")

    say("[4/4] Starting the website...")
    spawn("web", ["npm", "run", "dev", "--", "--host", "127.0.0.1"], ROOT / "frontend")
    if not wait_for("http://127.0.0.1:5173", "web", 90):
        fail("The website did not start. See logs/web.log")

    say("\n" + "=" * 70)
    say("  ALL RUNNING.  Open this in Chrome/Brave/Edge/Firefox:\n")
    say("      http://localhost:5173\n")
    say("  MetaMask accounts to import (fake money, local test chain only):\n")
    for role, addr, key in ACCOUNTS:
        say(f"    {role} {addr}\n               private key: {key}")
    say("\n  Press Ctrl+C in this window to stop everything.")
    say("  Logs are saved in the 'logs' folder if something looks wrong.")
    say("=" * 70)
    try:
        while True:
            time.sleep(2)
            for p in procs:
                if p.poll() is not None:
                    say("\n  A background process stopped unexpectedly. Check the 'logs' folder.")
                    raise KeyboardInterrupt
    except KeyboardInterrupt:
        say("\nStopping...")
    finally:
        stop_all()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        stop_all()
