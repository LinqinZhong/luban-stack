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
  const current = Number(res?.current || pagination?.current || 1) || 1
  const pageSize = Number(res?.pageSize || pagination?.pageSize || 10) || 10
  const total = Number(res?.total)
  // 兼容未返回 hasNext 的接口：用 total / 本页条数推断
  const next =
    typeof res?.hasNext === 'boolean'
      ? res.hasNext
      : Number.isFinite(total)
        ? current * pageSize < total
        : Array.isArray(res?.records) && res.records.length >= pageSize
  setData('hasNext', next)
  setData('pagination', {
    current: current + 1,
    pageSize,
  })
  // 用入参 isRefresh，勿用闭包里的 refreshing（调用时尚未 setData）
  if (isRefresh) {
    updateProps('data', res.records || [])
    showToast('刷新成功')
  } else {
    updateProps('data', [...($props.data || []), ...(res.records || [])])
  }
}).catch((err) => {
  console.error(err)
}).finally(() => {
  setData('refreshing', false)
  updateProps('loading', false)
  setData('loadingMore', false)
})
