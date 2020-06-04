import { Resource, ResourceTag, Spec } from '../src/spec'
import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{ mycontext: any }>

test('Resource path', (t) => {
  const res = new Resource({
    url: 'https://www.example.com/path/to/file?name=value',
  })
  t.is(res.path, 'get/https/www.example.com/path/to/file/index~name=value.html')
})

test('ResourceTag extname and mimeType', (t) => {
  const res = new Resource({
    url: 'https://www.example.com/path/to/file.HTML?name=value',
    headers: {
      'content-type': ['text/HTML; charset=UTF-8'],
    },
  })
  const rt = new ResourceTag(res)
  t.is(rt.extname, '.html')
  t.is(rt.mimeType, 'text/html')
})

test('Resource in spec', (t) => {
  const sampleUrl = 'https://www.example.com/path/to/file?name=value'
  const spec = new Spec()
  t.is(spec.lookupResource('get', sampleUrl), undefined)

  const res = spec.newResource({ method: 'get', url: sampleUrl })
  t.is(spec.resourcesLength, 1)
  t.is(spec.resourcesIndex['get'][sampleUrl].url, sampleUrl)
  t.is(spec.lookupResource('get', sampleUrl).url, sampleUrl)

  t.is(spec.findNearestResource('post', sampleUrl), undefined)
  t.is(spec.findNearestResource('get', 'https://example.com/path/to/file?name=value'), undefined)
  const nearest = spec.findNearestResource('get', 'https://www.example.com/path/to/file?name=VALUE')
  t.truthy(nearest)
  if (nearest) t.is(nearest.url, sampleUrl)
})

test('Filter resources', (t) => {
  const spec = new Spec()
  spec.newResource({ timestamp: 3, method: 'get', url: 'https://www.example.com/page1.html', headers: { 'content-type': 'text/html' } })
  spec.newResource({ timestamp: 2, method: 'get', url: 'https://www.example.com/page2.html', headers: { 'content-type': 'text/html' } })
  spec.newResource({ timestamp: 1, method: 'get', url: 'https://www.example.com/page2.php', headers: { 'content-type': 'text/html' } })
  spec.newResource({ timestamp: 0, method: 'get', url: 'https://www.example.com/image.jpg', headers: { 'content-type': 'image/jpeg' } })

  const htmls = spec.filterResources((tag, res) => {
    return tag.extname == '.html' || tag.mimeType == 'text/html'
  })

  t.is(htmls.length, 3)
  t.deepEqual(
    htmls.map((r) => r.timestamp),
    [1, 2, 3]
  )

  const jpegs = spec.filterResources((tag, res) => {
    return tag.mimeType == 'image/jpeg'
  })

  t.deepEqual(
    jpegs.map((r) => r.timestamp),
    [0]
  )
})
