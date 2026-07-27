/*@voider-method
{
  "name": "loadData",
  "params": [],
  "returnType": "void"
}
*/

if(loading || !hasNext) return
setData('loading', true)
$props.fetchApi({
  page: pagination
}).then((res) => {
  setData('hasNext', res.hasNext)
  setData('pagination',{
    current: res.current+1,
    pageSize: res.pageSize
  })
  if(refreshing){
    updateProps('data', res.records)
    showToast('刷新成功')
  }else{
    updateProps('data', [...$props.data ,...(res.records || [])])
  }
}).catch((err) => {
  console.error(err)
}).finally(() => {
  setData('refreshing', false)
  setData('loading', false)
})
