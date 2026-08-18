/*@luban-method
{
  "name": "inputFunc",
  "params": [
    {
      "name": "func",
      "type": "string"
    }
  ],
  "returnType": "void"
}
*/

if (display === '0') {
  setData('display', func + '(');
} else {
  setData('display', display + func + '(');
}
