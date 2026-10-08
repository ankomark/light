#!/usr/bin/env bash
# One-time setup of a fresh Hetzner box (Ubuntu 24.04), as root:
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/app/setup.sh -o setup.sh
#   bash setup.sh            (or copy it over with scp)
#
# Safe to run again. It:
#   - updates the system; security updates install themselves from then on
#   - installs Docker, git, fail2ban
#   - creates the `deploy` user (sudo, docker) with root's SSH keys
#   - SSH: keys only, no root login (only once `deploy` has a key)
#   - firewall: SSH, HTTP, HTTPS only
#   - 2 GB swap, Docker log rotation, /opt/adventlife, the job schedule
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
say() { echo -e "\n== $*"; }

say "System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq git curl ufw fail2ban unattended-upgrades cron ca-certificates
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
JSON
systemctl restart docker

say "The deploy user"
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG sudo,docker deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
mkdir -p /home/deploy/.ssh
if [ -s /root/.ssh/authorized_keys ]; then
  cp -n /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys || true
fi
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

say "SSH: keys only"
cat > /etc/ssh/sshd_config.d/90-adventlife.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 4
CONF
if [ -s /home/deploy/.ssh/authorized_keys ]; then
  echo 'PermitRootLogin no' >> /etc/ssh/sshd_config.d/90-adventlife.conf
  echo "Root login is now off: sign in as  ssh deploy@<this box>"
else
  echo "!! /home/deploy/.ssh/authorized_keys is empty - root login left ON until you add a key and re-run."
fi
systemctl reload ssh || systemctl reload sshd

say "Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Docker publishes ports past ufw: only Caddy publishes any (80/443), so the
# database and Redis are reachable from inside the box only.

say "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

say "Swap (2 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

say "App folder and logs"
mkdir -p /opt/adventlife /var/log/adventlife
chown deploy:deploy /opt/adventlife /var/log/adventlife

say "Job schedule"
if [ -f /opt/adventlife/light/deploy/app/crontab ]; then
  install -m 644 /opt/adventlife/light/deploy/app/crontab /etc/cron.d/adventlife
  systemctl restart cron
  echo "installed /etc/cron.d/adventlife"
else
  echo "(the repository isn't cloned yet: re-run this after step 4 of README.md to install the schedule)"
fi
cat > /etc/logrotate.d/adventlife <<'CONF'
/var/log/adventlife/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
CONF

say "Done. Next: README.md step 4 (as deploy)."
