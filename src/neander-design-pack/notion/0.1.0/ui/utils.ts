import { cx } from 'class-variance-authority';

/** Semantic classes need conditional composition, without a global Tailwind merge/reset. */
export const cn = cx;
