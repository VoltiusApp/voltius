#!/bin/sh
set -e

# The rules `ufw limit 22/tcp` generates, applied directly so the log prefix
# matches the one reported in #90 verbatim.
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --set
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent \
  --update --seconds 30 --hitcount 6 -j LOG --log-prefix "[UFW LIMIT BLOCK] "
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent \
  --update --seconds 30 --hitcount 6 -j REJECT

exec /usr/sbin/sshd -D -e
