import { PlaybackProxy } from './proxy'
import Path from 'path'

const pp = new PlaybackProxy({
  cacheRoot: Path.join(__dirname, '../tmp'),
  port: 8080,
  mode: 'offline',
})
pp.start()

process.on('SIGINT', () => {
  pp.stop()
})
