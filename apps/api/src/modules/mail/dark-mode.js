/**
 * Color locks for our generated email HTML (not a general HTML parser).
 * Gmail iOS may invert both dark backgrounds and light text, ignoring color-scheme.
 * Apply solid-color image layers only in Gmail; clients stripping the stylesheet
 * keep the original inline colors and can invert background/text together.
 * Text gets its own span so image layers never paint over photos or table cells.
 * Technique: https://github.com/matthieuSolente/email-darkmode#keep-text-colors-in-gmail
 */
export function preserveEmailColors(html) {
  const backgrounds = new Set();
  const inks = new Set();
  const stack = [];
  const voidTags = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr']);
  const body = html.match(/<body\b[^>]*>[\s\S]*<\/body>/i)?.[0];
  if (!body) return html;

  const protectedBody = body.replace(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g, (token) => {
    if (token.startsWith('<!--')) return token;
    if (!token.startsWith('<')) {
      const color = stack.at(-1)?.color;
      if (!/^#[\da-f]{6}$/i.test(color || '') || !token.trim()) return token;
      const hex = color.slice(1).toLowerCase();
      inks.add(hex);
      return `<span class="km-ink-${hex}">${token}</span>`;
    }
    const closing = token.match(/^<\/([\w-]+)/);
    if (closing) {
      const index = stack.findLastIndex((entry) => entry.tag === closing[1].toLowerCase());
      if (index >= 0) stack.length = index;
      return token;
    }
    const tag = token.match(/^<([\w-]+)/)?.[1].toLowerCase();
    if (!tag) return token;
    const style = token.match(/\bstyle="([^"]*)"/i)?.[1] || '';
    const color = style.match(/(?:^|;)\s*color\s*:\s*(#[\da-f]{6}|transparent)\s*(?:;|$)/i)?.[1]
      || stack.at(-1)?.color;
    if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push({ tag, color });
    const background = style.match(/(?:^|;)\s*background-color\s*:\s*(#[\da-f]{6})\s*(?:;|$)/i)?.[1]
      || token.match(/\bbgcolor="(#[\da-f]{6})"/i)?.[1];
    if (!background) return token;
    const hex = background.slice(1).toLowerCase();
    backgrounds.add(hex);
    return /\bclass="/i.test(token)
      ? token.replace(/\bclass="/i, `class="km-bg-${hex} `)
      : token.replace(/^<([\w-]+)/, `<$1 class="km-bg-${hex}"`);
  });

  const gmailRules = [
    ...[...backgrounds].map((hex) => `u + .body .km-bg-${hex},u + .body.km-bg-${hex}{background-image:linear-gradient(#${hex},#${hex});}`),
    // Both stops are identical: this preserves a solid ink color, not a visual gradient.
    ...[...inks].map((hex) => `u + .body .km-ink-${hex}{background-image:linear-gradient(#${hex},#${hex});background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#${hex};}`)
  ].join('\n');
  const darkRules = [
    ...[...backgrounds].map((hex) => `.km-bg-${hex}{background-color:#${hex}!important;}`),
    ...[...inks].map((hex) => `.km-ink-${hex}{color:#${hex}!important;}`)
  ].join('\n');
  return html.replace(body, () => protectedBody).replace('</style>', () =>
    `${gmailRules}\n@media (prefers-color-scheme:dark){${darkRules}}\n</style>`);
}
