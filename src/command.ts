#!/usr/bin/env node

import Yargs from 'yargs'
import { PlaybackProxy, PlaybackProxyMode } from './proxy'
import GetPort from 'get-port'
const Package = require('../package.json')

Yargs.usage(`Usage: $0 -l "stdio" -d "exec {programPath: '/path/to/listener.sh'}"`)
  .version(Package.version, 'version')
  .option('root', { alias: 'r', description: 'Cache root directory.', default: './' })
  .option('port', { alias: 'p', description: 'Proxy port. Assign unused port if 0.', default: 0 })
  .option('mode', { alias: 'm', description: 'Mode: online, offline or mixed.', choices: ['mixed', 'online', 'offline'], default: 'mixed' })
  .option('no-throttling', { alias: 'T', description: 'Disable resource TTFB and datarate.', boolean: true, default: false })
  .option('cascade', { alias: 'c', description: 'Cascaded contents path.' })
  .option('latency-gap', { descritpion: 'Assumed millisecond gap of this proxy.', number: true, default: 15 })
  .option('debug-headers', { alias: 'd', description: 'Returns debug information in response headers.', boolean: true, default: false })
  .option('auto-save', { description: 'Auto save each N seconds.', number: true, default: 5 })
  .option('ssl-ca-dir', { description: 'Use the-dir/cert/ca.pem for SSL.', string: true, default: '' })
  .command(
    '*',
    'Starts playback proxy',
    () => {},
    async (argv) => {
      const cascading = ((Array.isArray(argv.cascade) ? argv.cascade : argv.cascace) || []) as string[]
      const port = argv.port || (await GetPort())
      const proxy = new PlaybackProxy({
        cacheRoot: argv.root,
        port,
        cascading,
        mode: argv.mode as PlaybackProxyMode,
        throttling: !argv.noThrottling,
        responseDebugHeaders: !!argv.debugHeaders,
        sslCaDir: argv.sslCaDir as string,
      })

      await proxy.start()

      console.log(`Playback proxy started on ${proxy.cacheRoot} as http://localhost:${proxy.port}`)

      const autoSave = setInterval(() => {
        proxy.saveSpec()
      }, 5 * 1000)

      process.on('SIGINT', () => {
        clearInterval(autoSave)
        proxy.stop().then(() => {
          process.exit()
        })
      })
    }
  ).argv
