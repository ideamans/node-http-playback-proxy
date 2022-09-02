This is a HTTP proxy like VCR.

vcr
https://www.npmjs.com/package/vcr

It assumed to use for web page performance tests.

If you are going to 2 tests to same page:

- Performance test A -> https://example.com/
- Performance test B -> https://example.com/

Performance of https://example.com/ are not same always.

`http-playback-proxy` tries to reproduces download latency and throughput for each request.

- Recording -> `http-playback-proxy`(recording) -> https://exmaple.com/
- Performance test A -> `http-playback-proxy`(playback) -> https://example.com/
- Performance test B -> `http-playback-proxy`(playback) -> https://example.com/

# Usage

```js

```
