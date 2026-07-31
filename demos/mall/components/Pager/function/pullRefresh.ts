/*@voider-method
{
  "name": "pullRefresh",
  "params": [],
  "returnType": "void"
}
*/

if($props.loading || refreshing) return
setData('hasNext', true)
setData('pagination',{
  current: 1,
  pageSize: 10
})
loadData(true)
