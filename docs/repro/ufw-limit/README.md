# Reproducing #90 — healthcheck ping vs `ufw limit`

Reproduces the firewall rate-limit from issue #90 and measures how many
connections Voltius's reachability probing gets blocked for.

## Build and run

    docker build -t voltius-ufw-repro docs/repro/ufw-limit
    docker run -d --name ufw-repro --cap-add=NET_ADMIN -p 2222:22 voltius-ufw-repro

`--cap-add=NET_ADMIN` is required for the iptables rules. The container
applies the rules `ufw limit 22/tcp` generates: block a source after 6 new
connections in 30 seconds.

## Counting blocks

Count from the REJECT rule's packet counter, not from the kernel log. The
`LOG` rule is kept so the setup matches the issue verbatim, but its output
goes to the host kernel ring buffer and is not reliably emitted from a
container network namespace.

    docker exec ufw-repro iptables -L INPUT -n -v | awk '/REJECT/ {print $1}'

Reset the counters before each measurement window:

    docker exec ufw-repro iptables -Z INPUT

Note that a TCP connect from the host to the published port always *appears*
to succeed: Docker's userland proxy accepts it before the container rejects
it. The counter is the ground truth, not the client's return code.

## Measure

1. Add a Voltius connection to `localhost:2222`, user `tester`, password `tester`.
2. Open a terminal session to it and open the SFTP side pane.
3. Zero the counters, wait five minutes, then read the REJECT count.
4. Repeat against a build from before the fix.

## Pass condition

Non-zero before, zero after, over five minutes with a session open.

Record both numbers in issue #90.

## Sanity check

To confirm the firewall itself works, independent of Voltius:

    docker exec ufw-repro iptables -Z INPUT
    for i in $(seq 1 10); do timeout 2 bash -c 'echo > /dev/tcp/127.0.0.1/2222'; done
    docker exec ufw-repro iptables -L INPUT -n -v | awk '/REJECT/ {print $1}'

Expect 4 or 5 — the first 6 connections in the window pass, the rest are
blocked.
