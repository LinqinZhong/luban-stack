/*@voider-method
{
  "name": "sendMessage",
  "params": [],
  "returnType": "void"
}
*/

if(content.trim().length === 0) return
setData('messageList', [...messageList, {
  id: Date.now(),
  content,
  userId: '1',
  name: '小明'
}])
setData('content', '')
