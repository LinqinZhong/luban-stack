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
  updateProps('data', [...$props.data ,...res.records])
}).finally(() => {
  setData('loading', false)
})
