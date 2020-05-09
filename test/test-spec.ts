import { Resource, Spec } from '../src/spec'
import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{ mycontext: any }>

test('About resource', (t) => {
  const res = new Resource({
    url: 'https://www.example.com/path/to/file?name=value',
  })
  t.is(res.path, 'get/https/www.example.com/path/to/file/index~name=value.html', 'ファイルパスが自動で設定されること')
})

test('SpecのResource管理について', (t) => {
  const sampleUrl = 'https://www.example.com/path/to/file?name=value'
  const spec = new Spec()
  t.is(spec.lookupResource('get', sampleUrl), undefined)

  const res = spec.newResource({ method: 'get', url: sampleUrl })
  t.is(spec.resources.length, 1)
  t.is(spec.resourcesIndex['get'][sampleUrl].url, sampleUrl)
  t.is(spec.lookupResource('get', sampleUrl).url, sampleUrl)

  t.is(spec.findNearestResource('post', sampleUrl), undefined)
  t.is(spec.findNearestResource('get', 'https://example.com/path/to/file?name=value'), undefined)
  const nearest = spec.findNearestResource('get', 'https://www.example.com/path/to/file?name=VALUE')
  t.truthy(nearest)
  if (nearest) t.is(nearest.url, sampleUrl)
})
