/*@luban-method
{
  "name": "loadData",
  "params": [
    {
      "name": "isRefresh",
      "type": "boolean"
    }
  ],
  "returnType": "void"
}
*/

if($props.loading || !hasNext) return
if(isRefresh) {
  setData('refreshing', true)
}else if($props.data && Array.isArray($props.data) && $props.data.length > 0){
  setData('loadingMore', true)
}else{
  updateProps('loading', true)
}
const args = {
  page: pagination,
}
$props.fetchApi(args).then((res) => {
  setData('hasNext', res.hasNext)
  setData('pagination',{
    current: res.current+1,
    pageSize: res.pageSize
  })
  // 用入参 isRefresh，勿用闭包里的 refreshing（调用时尚未 setData）
  if(isRefresh){
    updateProps('data', res.records || [])
    showToast('刷新成功')
  }else{
    updateProps('data', [...$props.data ,...(res.records || [])])
  }
}).catch((err) => {
  console.error(err)
}).finally(() => {
  setData('refreshing', false)
  updateProps('loading', false)
  setData('loadingMore', false)
})
