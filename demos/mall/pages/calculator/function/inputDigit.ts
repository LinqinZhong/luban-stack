/*@luban-method
{
  "name": "inputDigit",
  "params": [
    {
      "name": "digit",
      "type": "string"
    }
  ],
  "returnType": "void"
}
*/

if (display === '0') {
  setData('display', digit);
} else {
  setData('display', display + digit);
}
