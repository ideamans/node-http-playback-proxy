import { ProxyUrl } from '../src/url'
import anyTest, { TestInterface } from 'ava'
const test = anyTest as TestInterface<{ mycontext: any }>

test('URL pathnization', (t) => {
  const longparam = 'x'.repeat(1000)
  const shortparam = 'x'.repeat(246) // 256 - 9(image.jpg) - 1(~)
  t.is(new ProxyUrl('http://example.com').pathnize('get'), 'get/http/example.com/index.html')
  t.is(new ProxyUrl('http://example.com').pathnize('post'), 'post/http/example.com/index.html')
  t.is(new ProxyUrl('https://example.com').pathnize('post'), 'post/https/example.com/index.html')
  t.is(new ProxyUrl('https://example.com:8080').pathnize('post'), 'post/https/example.com~8080/index.html')

  t.is(new ProxyUrl('http://example.com/').pathnize('get'), 'get/http/example.com/index.html')
  t.is(new ProxyUrl('http://example.com/path/to').pathnize('get'), 'get/http/example.com/path/to/index.html')
  t.is(new ProxyUrl('http://example.com/path/to/').pathnize('get'), 'get/http/example.com/path/to/index.html')
  t.is(new ProxyUrl('http://example.com/path/to/image.jpg').pathnize('get'), 'get/http/example.com/path/to/image.jpg')
  t.is(new ProxyUrl('http://example.com/path/to/image.jpg').pathnize('get'), 'get/http/example.com/path/to/image.jpg')
  t.is(new ProxyUrl(`http://example.com/path/to/image.jpg?${longparam}`).pathnize('get'), `get/http/example.com/path/to/image~${shortparam}.jpg`)
})
