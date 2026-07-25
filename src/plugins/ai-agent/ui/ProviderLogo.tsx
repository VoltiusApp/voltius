import type { ProviderKind } from "../types";

// Clean in-house geometric brand marks, not pixel-accurate reproductions of the
// official logos (no vendored icon set in this repo carries them). Inlined as
// JSX rather than `?react`-imported `.svg` assets: under vitest, `?react`
// resolves through the default asset pipeline (vite-plugin-svgr is only
// registered in vite.config.ts, not in the standalone vitest.config.ts) and
// yields a data: URL string instead of a component, which React then rejects
// as an invalid element name. Swapping in official press-kit SVGs later only
// touches this file.

function AnthropicMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path fill="#D97757" d="M9.4 3.5 3 20.5h3.9l1.3-3.6h6.9l1.3 3.6H20L13.6 3.5H9.4Zm-.1 10.2 2.2-6.1 2.2 6.1H9.3Z" />
    </svg>
  );
}

// Monochrome by brand; drawn with currentColor so it inherits the surrounding text colour.
function OpenAIMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3L12 2.6Z" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth={1.8} />
    </svg>
  );
}

// Monochrome by brand; drawn with currentColor so it inherits the surrounding text colour.
function OllamaMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M7.6 2c.9 0 1.5.9 1.6 2.1l.2 2.2h5.2l.2-2.2C14.9 2.9 15.5 2 16.4 2s1.6 1 1.5 2.3l-.3 3.2c1 .9 1.6 2.2 1.6 3.7v5.2c0 2-1.5 3.6-3.4 3.6H8.2c-1.9 0-3.4-1.6-3.4-3.6v-5.2c0-1.5.6-2.8 1.6-3.7l-.3-3.2C6 3 6.7 2 7.6 2Z"
      />
    </svg>
  );
}

// The gradient id is file-scoped; repeated instances on one page all reference
// the same gradient definition, so duplicate ids resolve identically — safe.
function GeminiMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="vlt-ai-gemini" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset=".5" stopColor="#9B72CB" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path fill="url(#vlt-ai-gemini)" d="M12 1.5c.7 5.2 4.8 9.3 10 10-5.2.7-9.3 4.8-10 10-.7-5.2-4.8-9.3-10-10 5.2-.7 9.3-4.8 10-10Z" />
    </svg>
  );
}

const MARKS: Record<ProviderKind, React.FC<React.SVGProps<SVGSVGElement>>> = {
  anthropic: AnthropicMark,
  "openai-compatible": OpenAIMark,
  ollama: OllamaMark,
  google: GeminiMark,
};

/**
 * Provider brand mark. OpenAI's and Ollama's marks are monochrome by brand and
 * drawn with `currentColor`, so they inherit the surrounding text colour and
 * need no per-appearance variant; Anthropic and Gemini carry their own colours.
 */
export function ProviderLogo({ kind, size = 16 }: { kind: ProviderKind; size?: number }) {
  const Mark = MARKS[kind];
  return <Mark width={size} height={size} data-testid={`provider-logo-${kind}`} aria-hidden />;
}
