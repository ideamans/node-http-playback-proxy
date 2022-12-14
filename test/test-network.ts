import { Resource, ResourceTag, Network } from '../src/network'
import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{}>

test('Resource path', (t) => {
  const get = new Resource({
    method: 'GET',
    url: 'https://www.example.com/path/to/file?name=value',
  })
  t.is(get.path, 'get/https/www.example.com/path/to/file/index~name=value.html')

  const head = new Resource({
    method: 'HEAD',
    url: 'https://www.example.com/path/to/file?name=value',
  })
  t.is(
    head.path,
    'head/https/www.example.com/path/to/file/index~name=value.html'
  )

  const post = new Resource({
    method: 'POST',
    url: 'https://www.example.com/path/to/file?name=value',
  })
  t.is(
    post.path,
    'post/https/www.example.com/path/to/file/index~name=value.html'
  )
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

test('Resource in network', (t) => {
  const network = new Network()
  const sampleUrl1 =
    'https://www.example.com/path/to/file?name1=value1&name2=value2'
  const sampleUrl2 =
    'https://www.example.com/path/to/file?name1=value1&name2=value2&name3=value3'

  t.is(network.lookupResource('get', sampleUrl1), undefined)

  network.newResource({ method: 'get', url: sampleUrl1 })
  t.is(network.resourcesLength, 1)
  t.is(network.resourcesIndex['get'][sampleUrl1].url, sampleUrl1)
  t.is(network.lookupResource('get', sampleUrl1).url, sampleUrl1)
})

test('Filter resources', (t) => {
  const network = new Network()
  network.newResource({
    timestamp: 3,
    method: 'get',
    url: 'https://www.example.com/page1.html',
    headers: { 'content-type': 'text/html' },
  })
  network.newResource({
    timestamp: 2,
    method: 'get',
    url: 'https://www.example.com/page2.html',
    headers: { 'content-type': 'text/html' },
  })
  network.newResource({
    timestamp: 1,
    method: 'get',
    url: 'https://www.example.com/page2.php',
    headers: { 'content-type': 'text/html' },
  })
  network.newResource({
    timestamp: 0,
    method: 'get',
    url: 'https://www.example.com/image.jpg',
    headers: { 'content-type': 'image/jpeg' },
  })

  const htmls = network.filterResources((tag, res) => {
    return tag.extname == '.html' || tag.mimeType == 'text/html'
  })

  t.is(htmls.length, 3)
  t.deepEqual(
    htmls.map((r) => r.timestamp),
    [1, 2, 3]
  )

  const jpegs = network.filterResources((tag, res) => {
    return tag.mimeType == 'image/jpeg'
  })

  t.deepEqual(
    jpegs.map((r) => r.timestamp),
    [0]
  )
})
