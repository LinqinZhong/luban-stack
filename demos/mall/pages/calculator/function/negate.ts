/*@luban-method
{
  "name": "negate",
  "params": [],
  "returnType": "void"
}
*/

if (display === '0') return;
if (display.startsWith('-(') && display.endsWith(')')) {
  setData('display', display.slice(2, -1));
} else if (display.startsWith('-') && !display.includes('+') && !display.includes('-') && !display.includes('*') && !display.includes('/')) {
  setData('display', display.slice(1));
} else {
  setData('display', '-(' + display + ')');
}
