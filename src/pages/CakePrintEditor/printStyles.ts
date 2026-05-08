export const PRINT_STYLES = `
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
    @page { size: A4; margin: 0; }
  }
`
