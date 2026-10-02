import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge must know our custom theme scales (see src/styles/index.css),
 * otherwise `text-13` would be read as a text color and dropped next to `text-ink`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        '11',
        '12',
        '13',
        '14',
        '15',
        '16',
        '17',
        '18',
        '20',
        '22',
        '24',
        '26',
        '28',
        '30',
        '32',
        '34',
        '40',
      ],
      radius: ['8', '10', '12', '14', '16'],
      shadow: ['popover', 'toast', 'dialog', 'drawer'],
      tracking: ['display', 'kicker', 'label'],
      font: ['body', 'display', 'mono', 'sans'],
    },
  },
})

/** Compose class names: conditional (clsx) + conflict-aware (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
