/**
 * Preloads all icon sets from local packages — no network requests ever made.
 * Both @iconify-json/lucide and @iconify-json/devicon-plain are bundled in the app.
 */
import { addCollection } from "@iconify/react";
import lucideIcons from "@iconify-json/lucide/icons.json";
import { icons as deviconPlainIcons } from "@iconify-json/devicon-plain";

let loaded = false;

export function preloadIcons() {
  if (loaded) return;
  loaded = true;

  // Lucide — used throughout the UI
  addCollection(lucideIcons as any);

  // Devicon plain subset — white icon on brand color background
  const DISTRO_PLAIN = [
    "ubuntu", "debian", "fedora", "centos", "archlinux", "redhat",
    "opensuse", "linux", "kalilinux", "linuxmint", "nixos", "gentoo",
    "raspberrypi",
  ];
  const distroPlainSubset: any = {
    prefix: "devicon-plain",
    icons: {} as Record<string, unknown>,
    width: deviconPlainIcons.width ?? 128,
    height: deviconPlainIcons.height ?? 128,
  };
  for (const name of DISTRO_PLAIN) {
    const icon = (deviconPlainIcons.icons as Record<string, unknown>)[name];
    if (icon) distroPlainSubset.icons[name] = icon;
  }
  addCollection(distroPlainSubset);

  // Custom icons — inline SVG, no package needed
  addCollection({
    prefix: "custom",
    icons: {
      ubuntu: {
        body: '<path fill="currentColor" stroke-width="0.7" stroke="currentColor" d="m8.668 19.273l1.006-1.742a6 6 0 0 0 8.282-4.781h2.012A8 8 0 0 1 18.929 16a8 8 0 0 1-1.452 1.835a2.5 2.5 0 0 0-1.976.227a2.5 2.5 0 0 0-1.184 1.595a7.98 7.98 0 0 1-5.65-.384m-1.3-.75a7.98 7.98 0 0 1-3.157-4.7C4.696 13.367 5 12.719 5 12c0-.72-.304-1.369-.791-1.825A8 8 0 0 1 5.073 8a8 8 0 0 1 2.295-2.524l1.006 1.742a6 6 0 0 0 0 9.563zm1.3-13.796a8 8 0 0 1 5.648-.387a2.497 2.497 0 0 0 3.161 1.825a8 8 0 0 1 2.49 5.085h-2.013A5.99 5.99 0 0 0 15 6.804a5.99 5.99 0 0 0-5.327-.335zM16 5.072a1.5 1.5 0 1 1 1.5-2.598A1.5 1.5 0 0 1 16 5.072M4.001 12a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0m12 6.928a1.5 1.5 0 1 1 1.5 2.598a1.5 1.5 0 0 1-1.5-2.598"/>',
      },
    },
    width: 24,
    height: 24,
  });
}

export function getDistroIcon(distro: string): string {
  const map: Record<string, string> = {
    ubuntu:  "custom:ubuntu",
    debian:  "devicon-plain:debian",
    fedora:  "devicon-plain:fedora",
    centos:  "devicon-plain:centos",
    arch:    "devicon-plain:archlinux",
    rhel:    "devicon-plain:redhat",
    opensuse:"devicon-plain:opensuse",
    kali:    "devicon-plain:kalilinux",
    mint:    "devicon-plain:linuxmint",
    nixos:   "devicon-plain:nixos",
    gentoo:  "devicon-plain:gentoo",
    raspbian:"devicon-plain:raspberrypi",
  };
  return map[distro] ?? "devicon-plain:linux";
}

export function getDistroColor(distro: string): string {
  const map: Record<string, string> = {
    ubuntu:  "#E95420",
    debian:  "#A80030",  // alt: "#CE0056"
    fedora:  "#3C6EB4",
    centos:  "#932279",
    arch:    "#1793D1",
    rhel:    "#EE0000",
    opensuse:"#73BA25",
    kali:    "#268BEE",
    mint:    "#87CF3E",
    nixos:   "#5277C3",
    gentoo:  "#54487A",
    raspbian:"#C51A4A",
  };
  return map[distro] ?? "#4A5568";
}
