#!/usr/bin/env node

import Yargs from 'yargs'
import { PlaybackProxy, PlaybackProxyMode } from './proxy'
import GetPort from 'get-port'
const Package = require('../package.json')

Yargs.usage(
  `Usage: $0 -l "stdio" -d "exec {programPath: '/path/to/listener.sh'}"`
)
  .version(Package.version, 'version')
  .option('root', {
    alias: 'r',
    description: 'Cache root directory.',
    default: './',
  })
  .option('host', {
    alias: 'h',
    description: 'Hostname of proxy.',
    default: 'localhost',
  })
  .option('port', {
    alias: 'p',
    description: 'Proxy port. Assign unused port if 0.',
    default: 0,
  })
  .option('mode', {
    alias: 'm',
    description: 'Mode: online, offline or mixed.',
    choices: ['mixed', 'online', 'offline'],
    default: 'mixed',
  })
  .option('no-waiting', {
    alias: 'W',
    description: 'Disable resource TTFB waiting.',
    boolean: true,
    default: false,
  })
  .option('no-throttling', {
    alias: 'T',
    description: 'Disable resource data rate.',
    boolean: true,
    default: false,
  })
  .option('latency-gap', {
    description: 'Assumed millisecond gap of this proxy.',
    number: true,
    default: 15,
  })
  .option('debug-headers', {
    alias: 'd',
    description: 'Returns debug information in response headers.',
    boolean: true,
    default: false,
  })
  .option('auto-save', {
    description: 'Auto save each N seconds.',
    number: true,
    default: 5,
  })
  .option('ssl-ca-dir', {
    description: 'Use the-dir/cert/ca.pem for SSL.',
    string: true,
    default: '',
  })
  .command(
    '*',
    'Starts playback proxy',
    () => {},
    async (argv) => {
      const port = argv.port ? argv.port : await GetPort()
      const proxy = new PlaybackProxy({
        cacheRoot: argv.root,
        host: argv.host,
        port,
        mode: argv.mode as PlaybackProxyMode,
        waiting: !argv.noWaiting,
        throttling: !argv.noThrottling,
        responseDebugHeaders: !!argv.debugHeaders,
        sslCaDir: argv.sslCaDir as string,
      })

      await proxy.start()

      console.log(
        `Playback proxy started on ${proxy.cacheRoot} as http://${proxy.host}:${proxy.port}`
      )

      const autoSave = setInterval(() => {
        proxy.saveNetwork()
      }, 5 * 1000)

      process.on('SIGINT', () => {
        clearInterval(autoSave)
        proxy.stop().then(() => {
          process.exit()
        })
      })
    }
  ).argv
