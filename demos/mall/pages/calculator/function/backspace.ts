/*@luban-method
{
  "name": "backspace",
  "params": [],
  "returnType": "void"
}
*/

if (display === '0' || display.length <= 1) {
  setData('display', '0');
  return;
}
const funcs = ['sin(', 'cos(', 'tan(', 'log(', 'ln(', 'sqrt('];
for (const f of funcs) {
  if (display.endsWith(f)) {
    setData('display', display.slice(0, -f.length));
    return;
  }
}
setData('display', display.slice(0, -1));
