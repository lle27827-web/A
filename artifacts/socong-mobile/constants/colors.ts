/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Palette synchronized with the Sổ Công web app.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#32251B',
    tint: '#9B6413',

    // Core surfaces
    background: '#E7C95D',
    foreground: '#32251B',

    // Cards / elevated surfaces
    card: '#F6EAB6',
    cardForeground: '#32251B',

    // Primary action color (buttons, links, active states)
    primary: '#9B6413',
    primaryForeground: '#FFFFFF',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#E9DDAE',
    secondaryForeground: '#32251B',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#E2D29C',
    mutedForeground: '#58432E',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#D8B84A',
    accentForeground: '#32251B',

    // Destructive actions (delete, error states)
    destructive: '#B83225',
    destructiveForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#8A5D2D',
    input: '#D4B56B',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
