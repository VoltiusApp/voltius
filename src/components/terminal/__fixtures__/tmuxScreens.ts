// Layouts as tmux 3.4 paints them in a 60x14 terminal (`split-window -h`, then
// `split-window -v` on the right), status line included.
export const TMUX_COLS = 60;

const status = '[t] 0:sh*                     "4526601c7cb4" 15:23 10-Nov-26';

export const sideBySide = [
  ...Array.from({ length: 13 }, (_, i) => `${`left ${i}`.padEnd(30)}│right ${i}`),
  status,
];

export const rightSplit = [
  ...Array.from({ length: 6 }, (_, i) => `${`left ${i}`.padEnd(30)}│right ${i}`),
  `${"left 6".padEnd(30)}├${"─".repeat(29)}`,
  ...Array.from({ length: 6 }, (_, i) => `${`left ${i + 7}`.padEnd(30)}│bottom ${i}`),
  status,
];

export const treeBesidePane = [
  `├── a${" ".repeat(25)}│right a`,
  `│   ├── b${" ".repeat(21)}│right b`,
  `│   └── c${" ".repeat(21)}│right c`,
  `└── d${" ".repeat(25)}│right d`,
  ...Array.from({ length: 9 }, () => `${" ".repeat(30)}│`),
  status,
];
