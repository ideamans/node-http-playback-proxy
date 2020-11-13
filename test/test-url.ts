import { ProxyUrl } from '../src/url'
import QueryString from 'querystring'
import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{ mycontext: any }>

test('URL pathnization', (t) => {
  const longparam = 'x'.repeat(1000)
  t.is(new ProxyUrl('http://example.com').pathnize('get'), 'get/http/example.com/index.html')
  t.is(new ProxyUrl('http://example.com').pathnize('post'), 'post/http/example.com/index.html')
  t.is(new ProxyUrl('https://example.com').pathnize('post'), 'post/https/example.com/index.html')
  t.is(new ProxyUrl('https://example.com:8080').pathnize('post'), 'post/https/example.com~8080/index.html')

  t.is(new ProxyUrl('http://example.com/').pathnize('get'), 'get/http/example.com/index.html')
  t.is(new ProxyUrl('http://example.com/path/to').pathnize('get'), 'get/http/example.com/path/to/index.html')
  t.is(new ProxyUrl('http://example.com/path/to/').pathnize('get'), 'get/http/example.com/path/to/index.html')
  t.is(new ProxyUrl('http://example.com/path/to/image.jpg').pathnize('get'), 'get/http/example.com/path/to/image.jpg')
  t.is(new ProxyUrl('http://example.com/path/to/image.jpg').pathnize('get'), 'get/http/example.com/path/to/image.jpg')
  t.is(new ProxyUrl(`http://example.com/path/to/image.jpg?${longparam}`).pathnize('get'), `get/http/example.com/path/to/image~xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx_4f135939.jpg`)
})

test('QueryString distance', (t) => {
  const qs1 = QueryString.parse('a=1&b=2&c=3&d=4')
  t.is(ProxyUrl.queryStringDistance(qs1, qs1), 0)

  const qs2 = QueryString.parse('a=0&b=2&c=3&d=4')
  t.is(ProxyUrl.queryStringDistance(qs1, qs2), 0.25)

  const qs3 = QueryString.parse('a=1&b=2&c=3&d=4&e=5')
  t.is(ProxyUrl.queryStringDistance(qs1, qs3), 0.20)

  const qs4 = QueryString.parse('b=2&c=3&d=4')
  t.is(ProxyUrl.queryStringDistance(qs1, qs4), 0.25)

  const qs5 = QueryString.parse('b=2&c=3&d=4&e=5')
  t.is(ProxyUrl.queryStringDistance(qs1, qs5), 0.40)

  const qs6 = QueryString.parse('e=5')
  t.is(ProxyUrl.queryStringDistance(qs1, qs6), 1)
})
