# Changelog

All notable changes to Voltius are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.52] - 2026-06-03

### Added

- Fedora / RHEL builds: releases now include a native `.rpm` package, installable
  with `sudo dnf install ./Voltius-*.x86_64.rpm`.

### Fixed

- Release build profile settings are now applied (they were previously ignored),
  producing roughly 10% smaller binaries.
