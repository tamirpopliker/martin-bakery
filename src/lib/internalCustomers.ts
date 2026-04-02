// ─── מיפוי לקוחות פנימיים (סניפים) ────────────────────────────────────────
// שימוש סינכרוני — ללא קריאות DB
// זיהוי לפי מילות מפתח (fuzzy) כדי לתפוס וריאציות של שמות לקוחות

export interface InternalMapping {
  customerPattern: string
  keywords: string[]
  branchId: number
  branchName: string
}

/**
 * מיפוי קבוע: שם לקוח במפעל → סניף.
 * מילות המפתח נשארות קשיחות כי הן מבוססות על שמות לקוחות
 * במערכת הנהלת חשבונות (Base44). סניפים חדשים יוסיפו ערכים
 * למערך דרך setInternalCustomerMap.
 */
let INTERNAL_CUSTOMER_MAP: InternalMapping[] = [
  { customerPattern: 'מרטין- אברהם אבינו', keywords: ['אברהם'],       branchId: 1, branchName: 'אברהם אבינו' },
  { customerPattern: 'מרטין - עמק שרה',    keywords: ['עמק שרה'],     branchId: 2, branchName: 'הפועלים' },
  { customerPattern: 'מרטין - יעקב כהן',   keywords: ['יעקב'],        branchId: 3, branchName: 'יעקב כהן' },
]

/** Allow updating the internal customer map (e.g. from DB data) */
export function setInternalCustomerMap(map: InternalMapping[]) {
  INTERNAL_CUSTOMER_MAP = map
}

/** Get the current map (for consumers that need to iterate) */
export function getInternalCustomerMap(): InternalMapping[] {
  return INTERNAL_CUSTOMER_MAP
}

/**
 * בודק אם שם לקוח מתאים לסניף פנימי.
 * זיהוי לפי: שם שמתחיל ב-"מרטין" + מילת מפתח של הסניף.
 * מחזיר branchId אם פנימי, null אם חיצוני.
 */
export function detectBranchId(customerName: string): number | null {
  const mapping = detectInternalMapping(customerName)
  return mapping ? mapping.branchId : null
}

/**
 * מחזיר את פרטי המיפוי המלא (כולל שם סניף) אם הלקוח פנימי
 */
export function detectInternalMapping(customerName: string): InternalMapping | null {
  if (!customerName) return null
  const trimmed = customerName.trim()
  // שלב 1: בדיקה האם השם מכיל "מרטין" (חובה)
  if (!trimmed.includes('מרטין')) return null
  // שלב 2: חיפוש מילת מפתח של סניף
  for (const m of INTERNAL_CUSTOMER_MAP) {
    if (m.keywords.some(kw => trimmed.includes(kw))) {
      return m
    }
  }
  // שם מכיל "מרטין" אבל לא תואם סניף ספציפי — עדיין פנימי, ברירת מחדל סניף 1
  return INTERNAL_CUSTOMER_MAP[0] || null
}

/**
 * מחזיר את שם הסניף לפי branchId
 */
export function getBranchNameById(branchId: number): string | null {
  const match = INTERNAL_CUSTOMER_MAP.find(m => m.branchId === branchId)
  return match ? match.branchName : null
}
