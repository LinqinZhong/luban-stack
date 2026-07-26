/*@voider-method
{
  "name": "refresh",
  "params": [],
  "returnType": "void"
}
*/

if(loading) return
updateProps('data', [])
setData('hasNext', true)
setData('pagination',{
  current: 1,
  pageSize: 10
})
setData('refreshing', true)
loadData()
