/*@luban-method
{
  "name": "calculate",
  "params": [],
  "returnType": "void"
}
*/

let expr = display;
expr = expr.replace(/π/g, '(Math.PI)');
expr = expr.replace(/\be\b/g, '(Math.E)');
expr = expr.replace(/sin\(([^()]+)\)/g, 'Math.sin(($1)*Math.PI/180)');
expr = expr.replace(/cos\(([^()]+)\)/g, 'Math.cos(($1)*Math.PI/180)');
expr = expr.replace(/tan\(([^()]+)\)/g, 'Math.tan(($1)*Math.PI/180)');
expr = expr.replace(/log\(/g, 'Math.log10(');
expr = expr.replace(/ln\(/g, 'Math.log(');
expr = expr.replace(/sqrt\(/g, 'Math.sqrt(');
expr = expr.replace(/\^/g, '**');
expr = expr.replace(/%/g, '/100');
expr = expr.replace(/(\d+)!/g, '((function f(n){let r=1;for(let i=2;i<=n;i++)r*=i;return r;})($1))');
try {
  let result = new Function('return ' + expr)();
  result = parseFloat(result.toPrecision(12));
  setData('display', String(result));
} catch(e) {
  setData('display', 'Error');
}
