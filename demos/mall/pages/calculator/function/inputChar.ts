/*@luban-method
{
  "name": "inputChar",
  "params": [
    {
      "name": "char",
      "type": "string"
    }
  ],
  "returnType": "void"
}
*/

if (display === '0' && char !== '(' && char !== ')') {
  setData('display', char);
} else {
  setData('display', display + char);
}
