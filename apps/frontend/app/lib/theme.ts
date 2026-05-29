/** Single source of truth for Naive UI theme tokens.
 *
 *  ⚠️  Keep `common.bodyColor` and `common.textColorBase` in sync with the
 *      `--ypd-bg` / `--ypd-text` CSS variables in `styles/base.css` — the body
 *      paints those variables before Vue mounts, so a divergence flashes
 *      the wrong colour on the first frame after a hard reload.
 *
 *  Palette: indigo accent on a near-white surface, tuned for accessibility.
 *  All semantic colors are darker than Naive's defaults so badges + radio
 *  borders + dividers stay legible for users with lower vision contrast
 *  sensitivity. Borders use a 4.5:1-ish contrast against the card surface,
 *  text colors meet WCAG AA against `#FFFFFF` for body text. */
import type { GlobalThemeOverrides } from 'naive-ui';

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    // Indigo — deeper than the previous #4F46E5 for better contrast on white cards.
    primaryColor: '#3730A3',
    primaryColorHover: '#312E81',
    primaryColorPressed: '#1E1B4B',
    primaryColorSuppl: '#312E81',
    // Info — switched from sky #0EA5E9 to a deeper teal so downloading/converting/cached
    // badges read clearly, not as "pale blue noise" against the card background.
    infoColor: '#0F766E',
    infoColorHover: '#0D5E58',
    infoColorPressed: '#0A4A44',
    infoColorSuppl: '#0D5E58',
    successColor: '#15803D',
    successColorHover: '#166534',
    successColorPressed: '#14532D',
    successColorSuppl: '#166534',
    // Warning — deeper amber for the unavailable badge.
    warningColor: '#B45309',
    warningColorHover: '#92400E',
    warningColorPressed: '#78350F',
    warningColorSuppl: '#92400E',
    // Error — slight darken so "Failed" badges and the sign-out button feel decisive.
    errorColor: '#B91C1C',
    errorColorHover: '#991B1B',
    errorColorPressed: '#7F1D1D',
    errorColorSuppl: '#991B1B',
    bodyColor: '#F5F5F5',
    cardColor: '#FFFFFF',
    textColorBase: '#111827',
    textColor1: '#111827',
    textColor2: '#374151',
    textColor3: '#4B5563',
    // Borders bumped from #E5E7EB → #9CA3AF: the radio rings, input outlines, list
    // dividers and card edges now register as proper "edges" instead of hairlines.
    borderColor: '#9CA3AF',
    dividerColor: '#D1D5DB',
  },
  Tag: {
    // Round filled tags pop more on the lighter body, so we keep them as the
    // default style. The semantic colors above drive the bg + text.
    borderRadius: '999px',
  },
  Radio: {
    // Make the ring visible on light cards (default was too thin + light).
    radioSizeMedium: '20px',
    boxShadow: '0 0 0 1px #6B7280 inset',
    boxShadowActive: '0 0 0 1px #3730A3 inset',
    boxShadowFocus: '0 0 0 2px rgba(55,48,163,0.25), 0 0 0 1px #3730A3 inset',
    boxShadowHover: '0 0 0 1px #4B5563 inset',
  },
  Card: {
    borderColor: '#D1D5DB',
  },
};
