"""Throwaway SSH/SFTP server for the iOS simulator end-to-end run.

The simulator shares the runner's network, so the app reaches it on
127.0.0.1. One user, password from the environment, a real bash on a PTY,
exec requests run through bash, and an SFTP subsystem. Everything the client
types and everything the shell prints is logged, so the test can check the
terminal output without reading the WebGL canvas.

Usage: E2E_SSH_USER=... E2E_SSH_PASSWORD=... python ssh_server.py PORT LOG_DIR
"""

import asyncio
import os
import pty
import sys
import time

import asyncssh

USER = os.environ["E2E_SSH_USER"]
PASSWORD = os.environ["E2E_SSH_PASSWORD"]
PORT = int(sys.argv[1])
LOG_DIR = sys.argv[2]
os.makedirs(LOG_DIR, exist_ok=True)
EVENTS = open(os.path.join(LOG_DIR, "ssh-events.log"), "a", buffering=1)
PTY_OUT = open(os.path.join(LOG_DIR, "ssh-pty-output.log"), "ab", buffering=0)
PTY_IN = open(os.path.join(LOG_DIR, "ssh-pty-input.log"), "ab", buffering=0)


def event(*parts):
    EVENTS.write(f"{time.strftime('%H:%M:%S')} " + " ".join(str(p) for p in parts) + "\n")


class Server(asyncssh.SSHServer):
    def connection_made(self, conn):
        event("CONNECT", conn.get_extra_info("peername"))

    def connection_lost(self, exc):
        event("DISCONNECT", repr(exc))

    def begin_auth(self, username):
        event("AUTH_BEGIN", username)
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        ok = username == USER and password == PASSWORD
        event("AUTH_PASSWORD", username, "ok" if ok else "rejected")
        return ok

    def kbdint_auth_supported(self):
        return False

    def public_key_auth_supported(self):
        return False


async def run_exec(process):
    command = process.command.decode() if isinstance(process.command, bytes) else process.command
    event("EXEC", repr(command))
    proc = await asyncio.create_subprocess_exec(
        "/bin/bash", "-c", command,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    process.stdout.write(out)
    process.stderr.write(err)
    process.exit(proc.returncode or 0)


async def run_shell(process):
    cols, rows, *_ = process.get_terminal_size() or (80, 24)
    event("PTY_OPEN", process.get_terminal_type(), cols, rows)
    master, slave = pty.openpty()
    try:
        import fcntl, struct, termios
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows or 24, cols or 80, 0, 0))
    except Exception as exc:  # resizing is cosmetic
        event("WINSZ_ERROR", repr(exc))
    env = dict(os.environ, TERM=process.get_terminal_type() or "xterm-256color",
               PS1="e2e$ ", HOME=os.path.expanduser("~"))
    proc = await asyncio.create_subprocess_exec(
        "/bin/bash", "--noprofile", "--norc", "-i",
        stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True,
    )
    os.close(slave)
    loop = asyncio.get_running_loop()
    done = asyncio.Event()

    def on_master():
        try:
            data = os.read(master, 65536)
        except OSError:
            data = b""
        if not data:
            loop.remove_reader(master)
            done.set()
            return
        PTY_OUT.write(data)
        process.stdout.write(data)

    loop.add_reader(master, on_master)

    async def pump_input():
        try:
            while not process.stdin.at_eof():
                data = await process.stdin.read(65536)
                if not data:
                    break
                raw = data.encode() if isinstance(data, str) else data
                PTY_IN.write(raw)
                event("PTY_IN", repr(raw[:200]))
                os.write(master, raw)
        except (asyncssh.BreakReceived, asyncssh.TerminalSizeChanged) as exc:
            event("PTY_SIGNAL", type(exc).__name__)
        except Exception as exc:
            event("PTY_IN_ERROR", repr(exc))

    pump = asyncio.ensure_future(pump_input())
    await asyncio.wait([asyncio.ensure_future(done.wait()), asyncio.ensure_future(proc.wait())],
                       return_when=asyncio.FIRST_COMPLETED)
    pump.cancel()
    event("PTY_CLOSED", proc.returncode)
    try:
        os.close(master)
    except OSError:
        pass
    process.exit(proc.returncode or 0)


async def handle(process):
    if process.command:
        await run_exec(process)
    elif process.get_terminal_type():
        await run_shell(process)
    else:
        event("SHELL_WITHOUT_PTY")
        await run_exec_shell_no_pty(process)


async def run_exec_shell_no_pty(process):
    proc = await asyncio.create_subprocess_exec(
        "/bin/bash", "--noprofile", "--norc",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    await process.redirect(stdin=proc.stdin, stdout=proc.stdout)
    process.exit(await proc.wait())


class LoggingSFTP(asyncssh.SFTPServer):
    def __init__(self, chan):
        event("SFTP_OPEN")
        super().__init__(chan)


async def main():
    key = asyncssh.generate_private_key("ssh-ed25519")
    await asyncssh.create_server(
        Server, "127.0.0.1", PORT,
        server_host_keys=[key],
        process_factory=handle,
        sftp_factory=LoggingSFTP,
        allow_scp=True,
        encoding=None,
    )
    event("LISTENING", PORT)
    await asyncio.Future()


asyncio.run(main())
