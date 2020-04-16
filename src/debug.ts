import { PlaybackProxy } from './proxy'
import Path from 'path'

const pp = new PlaybackProxy({
  cacheRoot: Path.join(__dirname, '../tmp'),
  port: 8080,
  online: false,
})
pp.start()

process.on('SIGINT', () => {
  pp.stop()
})
