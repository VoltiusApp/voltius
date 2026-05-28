/**
 * Preloads all icon sets from local packages — no network requests ever made.
 * Both @iconify-json/lucide and @iconify-json/devicon-plain are bundled in the app.
 */
import { addCollection } from "@iconify/react";
import lucideSubset from "virtual:lucide-subset";
import { icons as deviconPlainIcons } from "@iconify-json/devicon-plain";

let loaded = false;

export function preloadIcons() {
  if (loaded) return;
  loaded = true;

  // Lucide — subset auto-generated at build time by vite-plugin-lucide-subset
  addCollection(lucideSubset as any);

  // Devicon plain subset — white icon on brand color background
  const DISTRO_PLAIN = [
    "ubuntu", "debian", "fedora", "centos", "archlinux", "redhat",
    "opensuse", "linux", "kalilinux", "linuxmint", "nixos", "gentoo",
    "raspberrypi", "docker", "nginx", "postgresql", "mysql", "redis",
    "nodejs", "python", "git", "kubernetes", "mongodb", "apache",
    "prometheus", "grafana",
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

  addCollection({
    prefix: "simple-icons",
    icons: {
      termius: {
        body: '<path fill="currentColor" d="M17.812 19.381A6.194 6.194 0 0 0 24 13.193c0-1.7-.723-3.352-1.958-4.515a6.01 6.01 0 0 0-6.005-5.955a6 6 0 0 0-2.731.656a6 6 0 0 0-4.12-1.635a6.01 6.01 0 0 0-6 5.743A6.22 6.22 0 0 0 0 12.917a6.225 6.225 0 0 0 6.706 6.2a6.43 6.43 0 0 0 5.508 3.14a6.4 6.4 0 0 0 5.347-2.881q.126.005.25.005zm-5.598 1.242A4.79 4.79 0 0 1 7.9 17.888l-.267-.562l-.613.108a4.592 4.592 0 0 1-5.387-4.516A4.59 4.59 0 0 1 4.34 8.734l.506-.228l-.026-.555a4.377 4.377 0 0 1 4.367-4.574c1.297 0 2.512.566 3.347 1.56l.47.56l.609-.407a4.35 4.35 0 0 1 2.425-.734a4.38 4.38 0 0 1 4.364 4.632l-.025.416l.322.265a4.61 4.61 0 0 1 1.669 3.524a4.56 4.56 0 0 1-5.14 4.518l-.554-.071l-.267.49a4.76 4.76 0 0 1-4.192 2.493zm3.102-6.533l.016-.007c.212-.091.288-.171.288-.393v-.278c0-.244-.14-.401-.37-.401h-.013l-.046.01a4.5 4.5 0 0 1-1.502.272c-.48 0-.954-.09-1.409-.27l-.013-.005l-.052-.007c-.23 0-.37.157-.37.401v.278c0 .209.078.303.261.382l.02.009l.02.008a3.9 3.9 0 0 0 1.544.32c.525 0 1.071-.107 1.626-.319m-7.081-2.285c0-.224.116-.348.272-.38l1.501-.394l-1.505-.395c-.156-.041-.268-.164-.268-.38v-.473c0-.207.124-.296.266-.296q.07 0 .141.028l2.68.867c.203.068.315.231.315.455v.387c0 .224-.112.388-.316.456l-2.685.868a.4.4 0 0 1-.125.02c-.168 0-.276-.12-.276-.297z"/>',
      },
      kalilinux: {
        body: '<path fill="currentColor" d="M12.778 5.943s-1.97-.13-5.327.92c-3.42 1.07-5.36 2.587-5.36 2.587s5.098-2.847 10.852-3.008zm7.351 3.095l.257-.017s-1.468-1.78-4.278-2.648c1.58.642 2.954 1.493 4.021 2.665m.42.74c.039-.068.166.217.263.337c.004.024.01.039-.045.027c-.005-.025-.013-.032-.013-.032s-.135-.08-.177-.137s-.049-.157-.028-.195m3.448 8.479s.312-3.578-5.31-4.403a18 18 0 0 0-2.524-.187c-4.506.06-4.67-5.197-1.275-5.462c1.407-.116 3.087.643 4.73 1.408c-.007.204.002.385.136.552s.648.35.813.445c.164.094.691.43 1.014.85c.07-.131.654-.512.654-.512s-.14.003-.465-.119c-.326-.122-.713-.49-.722-.511s-.015-.055.06-.07c.059-.049-.072-.207-.13-.265s-.445-.716-.454-.73c-.009-.016-.012-.031-.04-.05c-.085-.027-.46.04-.46.04s-.575-.283-.774-.893c.003.107-.099.224 0 .469c-.3-.127-.558-.344-.762-.88c-.12.305 0 .499 0 .499s-.707-.198-.82-.85c-.124.293 0 .469 0 .469s-1.153-.602-3.069-.61c-1.283-.118-1.55-2.374-1.43-2.754c0 0-1.85-.975-5.493-1.406c-3.642-.43-6.628-.065-6.628-.065s6.45-.31 11.617 1.783c.176.785.704 2.094.989 2.723c-.815.563-1.733 1.092-1.876 2.97s1.472 3.53 3.474 3.58c1.9.102 3.214.116 4.806.942c1.52.84 2.766 3.4 2.89 5.703c.132-1.709-.509-5.383-3.5-6.498c4.181.732 4.549 3.832 4.549 3.832M12.68 5.663l-.15-.485s-2.484-.441-5.822-.204S0 6.38 0 6.38s6.896-1.735 12.68-.717"/>',
      },
      nginx: {
        body: '<path fill="currentColor" d="M12 0L1.605 6v12L12 24l10.395-6V6zm6 16.59c0 .705-.646 1.29-1.529 1.29c-.631 0-1.351-.255-1.801-.81l-6-7.141v6.66c0 .721-.57 1.29-1.274 1.29H7.32c-.721 0-1.29-.6-1.29-1.29V7.41c0-.705.63-1.29 1.5-1.29c.646 0 1.38.255 1.83.81l5.97 7.141V7.41c0-.721.6-1.29 1.29-1.29h.075c.72 0 1.29.6 1.29 1.29v9.18z"/>',
      },
      prometheus: {
        body: '<path fill="currentColor" d="M12 0C5.373 0 0 5.372 0 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-6.628-5.373-12-12-12m0 22.46c-1.885 0-3.414-1.26-3.414-2.814h6.828c0 1.553-1.528 2.813-3.414 2.813zm5.64-3.745H6.36v-2.046h11.28zm-.04-3.098H6.391q-.056-.064-.111-.13c-1.155-1.401-1.427-2.133-1.69-2.879c-.005-.025 1.4.287 2.395.511c0 0 .513.119 1.262.255c-.72-.843-1.147-1.915-1.147-3.01c0-2.406 1.845-4.508 1.18-6.207c.648.053 1.34 1.367 1.387 3.422c.689-.951.977-2.69.977-3.755c0-1.103.727-2.385 1.454-2.429c-.648 1.069.168 1.984.894 4.256c.272.854.237 2.29.447 3.201c.07-1.892.395-4.652 1.595-5.605c-.529 1.2.079 2.702.494 3.424c.671 1.164 1.078 2.047 1.078 3.716a4.64 4.64 0 0 1-1.11 2.996c.792-.149 1.34-.283 1.34-.283l2.573-.502s-.374 1.538-1.81 3.019z"/>',
      },
    },
    width: 24,
    height: 24,
  });

  // Custom icons — inline SVG, no package needed
  addCollection({
    prefix: "custom",
    icons: {
      mobaxterm: {
        width: 512,
        height: 496,
        body: '<path fill="#353535" d="M0 0h512v384h-41v2h-2v1h-1v1h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v1h-1v1h-2v2h-1v1h-1v1h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-4v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v2h-2v2h-5v-2h-3v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-1v-1h-1v-1h-2v-2h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1H0Z"/><path fill="#cccbcb" d="M0 0h512v384h-41v2h-2v1h-1v1h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v1h-1v1h-2v2h-1v1h-1v1h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-4v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v2h-2v2h-5v-2h-3v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-1v-1h-1v-1h-2v-2h-1v-1h-1v-1h-2v-1h2v-41h1v-1h1v-1h3v-2h1v-2h4v-2h2v-2h2v-2h2v-2h2v-2h2v-2h6v-4h3v-1h-1v-1h2v-2h4v-2h2v-2h2v-2h2v-2h1v-2h3v-2h4v-2h4v-2h2v-4h-2v-2h-2v-2h-3v-3h-1v-1h-3v-2h-2v-2h-2v-2h-1v-2h-2v-2h-4v-3h-1v-1h-3v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-3v-2h-2v-3h-1v-1h-2v-4h2v-2h2v-2h4v-2h2v-2h4v-2h2v-2h1v-2h3v-2h2v-2h2v-2h3v-1h1v-1h2v-2h2v-2h2v-2h4v-2h2v-2h2v-2h2v-2h2v-2h3v-2h3v-2h2v2h2v2h2v2h2v2h2v2h2v1h1v1h1v1h1v1h3v2h2v2h1v1h1v1h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v1h1v1h1v2h3v2h2v2h5v-2h2v-2h2v-2h4v-2h2v-2h2v-1h1v-1h1v-1h1v-1h3v-2h2v-2h2v-2h2v-2h4v-2h2v-2h2v-1h1v-1h1v-2h2v-2h3v-2h3v-2h2v-2h2v-2h3v-1h1v-1h3v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1V24H24v336h163v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1H0Z"/><path fill="#bffd03" d="M340 270h2v2h2v2h2v2h2v2h2v2h2v1h1v1h1v1h1v1h3v2h2v2h1v1h1v1h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v1h1v1h1v2h3v2h2v2h5v-2h2v-2h2v-2h4v-2h2v-2h2v-1h1v-1h1v-1h1v-1h3v-2h2v-2h2v-2h2v-2h4v-2h2v-2h2v-1h1v-1h1v-2h2v-2h3v-2h3v-2h2v-2h2v-2h3v-1h1v-1h3v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v2h2v2h2v2h2v2h2v44h-1v1h-1v1h-2v1h-1v1h-1v2h-2v1h-1v1h-2v1h-1v1h-1v1h-2v1h-1v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-2v1h-1v1h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v1h-1v1h-2v2h-1v1h-1v1h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-4v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v2h-2v2h-5v-2h-3v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-1v-1h-1v-1h-2v-2h-1v-1h-1v-1h-2v-1h2v-41h1v-1h1v-1h3v-2h1v-2h4v-2h2v-2h2v-2h2v-2h2v-2h2v-2h6v-4h3v-1h-1v-1h2v-2h4v-2h2v-2h2v-2h2v-2h1v-2h3v-2h4v-2h4v-2h2v-4h-2v-2h-2v-2h-3v-3h-1v-1h-3v-2h-2v-2h-2v-2h-1v-2h-2v-2h-4v-3h-1v-1h-3v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-3v-2h-2v-3h-1v-1h-2v-4h2v-2h2v-2h4v-2h2v-2h4v-2h2v-2h1v-2h3v-2h2v-2h2v-2h3v-1h1v-1h2v-2h2v-2h2v-2h4v-2h2v-2h2v-2h2v-2h2v-2h3v-2h3Z"/><path fill="#fd5d5b" d="M240 176h1v1h1v1h2v2h2v2h2v2h2v1h1v1h1v1h1v1h1v1h1v1h1v2h3v1h1v1h1v1h1v1h1v1h1v2h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v2h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v2h-2v2h-2v2h-2v2h-3v2h-3v2h-2v2h-2v2h-2v2h-3v2h-3v2h-2v2h-3v2h-2v2h-3v2h-2v2h-2v2h-4v2h-2v2h-2v2h-2v2h-2v2h-2v2h1v2h1v2h2v2h2v2h4v2h1v2h3v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h4v2h1v2h2v2h3v2h2v2h2v2h2v1h1v3h2v2h3v2h2v2h2v2h2v2h2v2h2v2h2v2h2v2h3v1h1v3h4v2h2v2h1v2h2v2h2v2h3v1h1v3h3v2h2v2h2v4h-2v2h-4v2h-4v2h-3v2h-1v2h-2v2h-2v2h-2v2h-4v2h-2v1h1v1h-3v4h-6v2h-2v2h-2v2h-2v2h-2v2h-2v2h-4v2h-1v2h-3v1h-1v1h-1v41h-3v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-1v-2h-4v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-3v-2h-1v-2h-4v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-47h2v-1h1v-1h1v-1h2v-2h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-2h2v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-2h2v-1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1Z"/><path fill="#619ffb" d="M399 135h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v2h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v2h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v2h1v1h1v1h1v1h1v42h-1v2h-1v2h-2v2h-3v2h-3v2h-2v2h-2v2h-3v2h-3v2h-2v2h-3v2h-1v2h-3v2h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h-3v1h-1v1h-3v2h-2v2h-2v2h-3v2h-3v2h-2v2h-1v1h-1v1h-2v2h-2v2h-4v2h-2v2h-2v2h-2v2h-3v1h-1v1h-1v1h-1v1h-2v2h-2v2h-4v2h-2v2h-2v2h-5v-2h-2v-2h-3v-2h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-2h-2v-2h-3v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v2h-3v2h-3v2h-2v2h-2v2h-2v2h-2v2h-4v2h-2v2h-2v2h-2v1h-1v1h-3v2h-2v2h-2v2h-3v2h-1v2h-2v2h-4v2h-2v2h-4v2h-2v2h-2v2h-2v-2h-2v-2h-3v-2h-2v-2h-1v-2h-4v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-3v-2h-1v-2h-4v-2h-2v-2h-2v-2h-1v-2h-1v-2h2v-2h2v-2h2v-2h2v-2h2v-2h4v-2h2v-2h2v-2h3v-2h2v-2h3v-2h2v-2h3v-2h3v-2h2v-2h2v-2h2v-2h3v-2h3v-2h2v-2h2v-2h2v-2h2v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-2h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2Z"/><path fill="#75c406" d="M494 321h2v43h-1v1h-1v1h-2v1h-1v1h-1v2h-2v1h-1v1h-2v1h-1v1h-1v1h-2v1h-1v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-2v1h-1v1h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-3v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v1h-1v1h-2v2h-1v1h-1v1h-2v1h-1v1h-1v1h-1v1h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-1v1h-1v1h-1v2h-4v2h-2v1h-1v1h-2v2h-2v2h-3v2h-2v2h-3v2h-2v2h-2v1h-1v1h-2v2h-2v1h-1v1h-2v2h-2v2h-2v2h-5v-2h-3v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-1v-1h-1v-1h-2v-2h-1v-1h-1v-1h-2v-1h2v-41h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h2v-1h1v-1h1v-1h1v-1h2v-1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-2h2v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-2h2v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-2h2v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h2v-2h2v-1h1Z"/><path fill="#c70304" d="M132 263h1v2h1v1h1v1h1v2h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v2h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v2h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h2v2h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v42h-3v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-1h-1v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-1v-2h-4v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-3v-2h-1v-2h-4v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2v-2h-2Z"/><path fill="#fcfcfc" d="M64 64h1v1h2v1h2v1h2v1h1v1h3v1h1v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h1v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h2v1h1v1h2v1h2v1h2v1h2v1h2v1h2v22h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-1v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-1v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-1v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-2v1h-1v1h-2v1h-2v-24h1v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h3v-1h1v-1h3v-1h2v-1h2v-1h2v-1h2v-1h2v-1h2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2v-1h-2Z"/><path fill="#548a08" d="M282 406h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h2v1h1v1h1v2h1v41h-5v-2h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-2v-2h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-2h-2v-2h-1v-1h-1v-1h-2v-2h-1v-1h-1v-1h-2v-1h2Z"/><path fill="#0259e5" d="M449 182h1v42h-1v2h-1v2h-2v2h-3v2h-3v2h-2v2h-2v2h-3v2h-3v2h-2v2h-3v2h-1v2h-3v1h-1v-1h-1v-1h-2v-1h-1v-2h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-2h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h1v-1h1v-1h2v-1h1v-1h1v-1h2v-1h1Z"/><path fill="#fff" d="M144 144h32v16h-32Z"/>',
      },
      ubuntu: {
        body: '<path fill="currentColor" stroke-width="0.7" stroke="currentColor" d="m8.668 19.273l1.006-1.742a6 6 0 0 0 8.282-4.781h2.012A8 8 0 0 1 18.929 16a8 8 0 0 1-1.452 1.835a2.5 2.5 0 0 0-1.976.227a2.5 2.5 0 0 0-1.184 1.595a7.98 7.98 0 0 1-5.65-.384m-1.3-.75a7.98 7.98 0 0 1-3.157-4.7C4.696 13.367 5 12.719 5 12c0-.72-.304-1.369-.791-1.825A8 8 0 0 1 5.073 8a8 8 0 0 1 2.295-2.524l1.006 1.742a6 6 0 0 0 0 9.563zm1.3-13.796a8 8 0 0 1 5.648-.387a2.497 2.497 0 0 0 3.161 1.825a8 8 0 0 1 2.49 5.085h-2.013A5.99 5.99 0 0 0 15 6.804a5.99 5.99 0 0 0-5.327-.335zM16 5.072a1.5 1.5 0 1 1 1.5-2.598A1.5 1.5 0 0 1 16 5.072M4.001 12a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0m12 6.928a1.5 1.5 0 1 1 1.5 2.598a1.5 1.5 0 0 1-1.5-2.598"/>',
      },
    },
    width: 24,
    height: 24,
  });
}

export const DISTRO_OPTIONS = [
  { id: "ubuntu", label: "Ubuntu" },
  { id: "debian", label: "Debian" },
  { id: "fedora", label: "Fedora" },
  { id: "centos", label: "CentOS" },
  { id: "rhel", label: "Red Hat" },
  { id: "arch", label: "Arch" },
  { id: "opensuse", label: "openSUSE" },
  { id: "kali", label: "Kali" },
  { id: "mint", label: "Linux Mint" },
  { id: "nixos", label: "NixOS" },
  { id: "gentoo", label: "Gentoo" },
  { id: "raspbian", label: "Raspberry Pi" },
  { id: "linux", label: "Linux" },
] as const;

export type DistroId = typeof DISTRO_OPTIONS[number]["id"];

export const CONNECTION_ICON_OPTIONS = [
  { group: "OS", id: "ubuntu", label: "Ubuntu" },
  { group: "OS", id: "debian", label: "Debian" },
  { group: "OS", id: "fedora", label: "Fedora" },
  { group: "OS", id: "centos", label: "CentOS" },
  { group: "OS", id: "rhel", label: "Red Hat" },
  { group: "OS", id: "arch", label: "Arch" },
  { group: "OS", id: "opensuse", label: "openSUSE" },
  { group: "OS", id: "kali", label: "Kali" },
  { group: "OS", id: "mint", label: "Linux Mint" },
  { group: "OS", id: "nixos", label: "NixOS" },
  { group: "OS", id: "gentoo", label: "Gentoo" },
  { group: "OS", id: "raspbian", label: "Raspberry Pi" },
  { group: "OS", id: "linux", label: "Linux" },
  { group: "Services", id: "docker", label: "Docker" },
  { group: "Services", id: "nginx", label: "Nginx" },
  { group: "Services", id: "apache", label: "Apache" },
  { group: "Services", id: "postgresql", label: "PostgreSQL" },
  { group: "Services", id: "mysql", label: "MySQL" },
  { group: "Services", id: "mongodb", label: "MongoDB" },
  { group: "Services", id: "redis", label: "Redis" },
  { group: "Services", id: "nodejs", label: "Node.js" },
  { group: "Services", id: "python", label: "Python" },
  { group: "Services", id: "git", label: "Git" },
  { group: "Services", id: "kubernetes", label: "Kubernetes" },
  { group: "Monitoring", id: "prometheus", label: "Prometheus" },
  { group: "Monitoring", id: "grafana", label: "Grafana" },
] as const;

export type ConnectionIconId = typeof CONNECTION_ICON_OPTIONS[number]["id"];

const DISTRO_ALIASES: Record<string, DistroId> = {
  ubuntu: "ubuntu",
  debian: "debian",
  fedora: "fedora",
  centos: "centos",
  rhel: "rhel",
  redhat: "rhel",
  redhatenterprise: "rhel",
  arch: "arch",
  archlinux: "arch",
  opensuse: "opensuse",
  "opensuse-leap": "opensuse",
  "opensuse-tumbleweed": "opensuse",
  sles: "opensuse",
  kali: "kali",
  mint: "mint",
  linuxmint: "mint",
  nixos: "nixos",
  gentoo: "gentoo",
  raspbian: "raspbian",
  raspberrypi: "raspbian",
  linux: "linux",
};

export function normalizeDistro(id: string): DistroId {
  return DISTRO_ALIASES[id.trim().toLowerCase()] ?? "linux";
}

export function getDistroLabel(distro: string): string {
  return DISTRO_OPTIONS.find((option) => option.id === normalizeDistro(distro))?.label ?? "Linux";
}

function normalizeConnectionIcon(icon: string): ConnectionIconId | DistroId {
  const normalized = icon.trim().toLowerCase();
  const distro = DISTRO_ALIASES[normalized];
  if (distro) return distro;
  return CONNECTION_ICON_OPTIONS.find((option) => option.id === normalized)?.id ?? "linux";
}

export function getConnectionIconLabel(icon: string): string {
  const normalized = normalizeConnectionIcon(icon);
  return CONNECTION_ICON_OPTIONS.find((option) => option.id === normalized)?.label ?? getDistroLabel(normalized);
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
    kali:    "simple-icons:kalilinux",
    mint:    "devicon-plain:linuxmint",
    nixos:   "devicon-plain:nixos",
    gentoo:  "devicon-plain:gentoo",
    raspbian:"devicon-plain:raspberrypi",
  };
  return map[normalizeDistro(distro)] ?? "devicon-plain:linux";
}

export function getConnectionIcon(icon: string): string {
  const normalized = normalizeConnectionIcon(icon);
  const map: Record<string, string> = {
    docker: "devicon-plain:docker",
    nginx: "simple-icons:nginx",
    apache: "devicon-plain:apache",
    postgresql: "devicon-plain:postgresql",
    mysql: "devicon-plain:mysql",
    mongodb: "devicon-plain:mongodb",
    redis: "devicon-plain:redis",
    nodejs: "devicon-plain:nodejs",
    python: "devicon-plain:python",
    git: "devicon-plain:git",
    kubernetes: "devicon-plain:kubernetes",
    prometheus: "simple-icons:prometheus",
    grafana: "devicon-plain:grafana",
  };
  return map[normalized] ?? getDistroIcon(normalized);
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
  return map[normalizeDistro(distro)] ?? "#4A5568";
}

export function getConnectionIconColor(icon: string): string {
  const normalized = normalizeConnectionIcon(icon);
  const map: Record<string, string> = {
    docker: "#2496ED",
    nginx: "#009639",
    apache: "#D22128",
    postgresql: "#336791",
    mysql: "#4479A1",
    mongodb: "#47A248",
    redis: "#DC382D",
    nodejs: "#5FA04E",
    python: "#3776AB",
    git: "#F05032",
    kubernetes: "#326CE5",
    prometheus: "#E6522C",
    grafana: "#F46800",
  };
  return map[normalized] ?? getDistroColor(normalized);
}
