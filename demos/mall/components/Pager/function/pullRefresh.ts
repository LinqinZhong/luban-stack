/*@voider-method
{
  "name": "pullRefresh",
  "params": [],
  "returnType": "void"
}
*/

if(loading) return
setData('hasNext', true)
setData('pagination',{
  current: 1,
  pageSize: 10
})
setData('refreshing', true)
loadData()
