import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function hexToRgba(hex: string, alpha: number) {
  if (!hex || typeof hex !== 'string') return `rgba(0, 0, 0, ${alpha})`;

  // Remove hash if present
  const cleanHex = hex.replace('#', '');

  // Basic validation
  if (!/^[0-9A-Fa-f]+$/.test(cleanHex)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  let r = 0, g = 0, b = 0;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else if (cleanHex.length === 8) {
    // Support 8-digit hex (RRGGBBAA) but ignore the alpha part
    // as we use the passed alpha argument
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  // Safety check for parsing errors
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
