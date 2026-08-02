/*@luban-method
{
  "name": "reset",
  "params": [],
  "returnType": "void"
}
*/

if($props.loading) return
setData('hasNext', true)
setData('pagination', {
  current: 1,
  pageSize: 10
})
updateProps('data', [])
// 延后拉取：等页面 setData/计算字段把 params 下发到本组件后再读
setTimeout(function () {
  loadData()
}, 0)
