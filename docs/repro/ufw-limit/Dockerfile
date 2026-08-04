FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server iptables && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /run/sshd \
 && useradd -m -s /bin/bash tester \
 && echo 'tester:tester' | chpasswd

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
