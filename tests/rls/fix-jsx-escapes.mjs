// Replace literal \uXXXX escape sequences in JSX text with actual Hebrew chars.
import fs from 'node:fs'
const path = 'src/pages/CEODashboard.tsx'
let s = fs.readFileSync(path, 'utf8')
const before = s

const replacements = [
  ['\\u25b2', '▲'],
  ['\\u25bc', '▼'],
  ['\\u05de\\u05d7\\u05d5\\u05d3\\u05e9 \\u05e7\\u05d5\\u05d3\\u05dd', 'מחודש קודם'],
]
for (const [k, v] of replacements) {
  s = s.split(k).join(v)
}

console.log('changed:', s !== before, 'len delta:', before.length - s.length)
fs.writeFileSync(path, s)
