import type { Orientation } from './types'

export function buildPrintStyles(orientation: Orientation): string {
  return `
  @media print {
    body * { visibility: hidden !important; }
    #cake-print-target, #cake-print-target * { visibility: visible !important; }
    #cake-print-target {
      display: block !important;
      position: absolute !important;
      inset: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    @page { size: A4 ${orientation}; margin: 0; }
  }
  `
}
