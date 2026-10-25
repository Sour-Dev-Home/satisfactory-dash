#!/bin/sh
# Installs the Linux agent from an unpacked release tarball (ADR-0057 Decision 2 step 5). Run as root, from the
# unpacked directory, AFTER verifying the tarball (docs-vault/wiki/runbooks/agent-linux.md).
#
# It checks Node, creates the unprivileged `satis-agent` user, copies agent.cjs and the systemd unit into place and
# reloads systemd. It does NOT enable or start anything: that is the next step, printed at the end, for you to run.
# It never downloads anything and the agent never updates itself; to update, verify and unpack the newer tarball and
# run this script again, then restart the service yourself.
set -eu

# The repo's Node: CI builds and tests on Node 22 (.github/workflows/ci.yml, node-version), so 22 is the floor.
MIN_NODE_MAJOR=22
APP_USER=satis-agent
APP_DIR=/opt/satis-agent
STATE_DIR=/var/lib/satis-agent
UNIT_DIR=/etc/systemd/system

here="$(dirname -- "$0")"

fail() {
  echo "install.sh: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "run as root (for example: sudo ./install.sh)."
[ -f "$here/agent.cjs" ] || fail "agent.cjs is not next to this script; run it from the unpacked release."
[ -f "$here/satis-agent.service" ] || fail "satis-agent.service is not next to this script."
command -v systemctl >/dev/null 2>&1 || fail "systemd (systemctl) is required."
command -v node >/dev/null 2>&1 || fail "Node.js ${MIN_NODE_MAJOR} or newer is required and 'node' was not found."

node_version="$(node --version)"
node_major="${node_version#v}"
node_major="${node_major%%.*}"
case "$node_major" in
  '' | *[!0-9]*) fail "could not read the Node version from '$node_version'." ;;
esac
[ "$node_major" -ge "$MIN_NODE_MAJOR" ] || fail "Node ${MIN_NODE_MAJOR} or newer is required; found $node_version."

if ! getent passwd "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$APP_USER"
  echo "created system user $APP_USER"
fi

# Code is root-owned and read-only to the service; state is the service user's alone.
install -d -o root -g root -m 755 "$APP_DIR"
install -o root -g root -m 644 "$here/agent.cjs" "$APP_DIR/agent.cjs"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$STATE_DIR"
install -o root -g root -m 644 "$here/satis-agent.service" "$UNIT_DIR/satis-agent.service"
systemctl daemon-reload

echo "installed $APP_DIR/agent.cjs and $UNIT_DIR/satis-agent.service (Node $node_version)."
echo "Nothing was enabled or started. Next, see the runbook (agent-linux.md): set the tokens, enrol, then"
echo "  sudo systemctl enable --now satis-agent"
