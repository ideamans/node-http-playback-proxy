# HTTP proxy that records resources as editable and playback them

## Install

    yarn add http-playback-proxy

## Example

```js
import { PlaybackProxy } from 'http-playback-proxy'

async function main() {
  const recorder = new PlaybackProxy({
    saveDir: '/path/to/resources',
    host: 'localhost',
    port: 8000,
    mode: 'online',
  })

  await recorder.start()

  // Set "http://localhsot:8000" as HTTP proxy and send request

  await recorder.stop()

  // See /path/to/resources and edit some resources

  const player = new PlaybackProxy({
    saveDir: '/path/to/resources',
    host: 'localhost',
    port: 8000,
    mode: 'online',
  })

  await player.start()

  // Set "http://localhsot:8000" as HTTP proxy and send request
  // Edited resource will changed

  await player.stop()
}

main()
```