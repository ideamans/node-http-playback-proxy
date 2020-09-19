import { URL } from 'url'
import Path from 'path'
import QueryString from 'querystring'

export class ProxyUrl extends URL {
  static directoryIndex = 'index.html'
  static maxFilenameLength = 256

  get filePath(): string {
    let path = this.pathname
    if (path.endsWith('/')) {
      path += ProxyUrl.directoryIndex
    } else {
      const ext = Path.extname(path)
      if (ext === '') {
        path = Path.join(path, ProxyUrl.directoryIndex)
      }
    }

    const dir = Path.dirname(path)
    const ext = Path.extname(path)
    const base = Path.basename(path, ext)

    let filename = base
    if (this.search !== '') {
      filename = `${filename}~${this.search.slice(1)}`.slice(0, ProxyUrl.maxFilenameLength - ext.length)
    }
    filename += ext

    return Path.join(dir, filename)
  }

  pathnize(method = 'get'): string {
    method = method.toLowerCase()
    return Path.join(method, this.protocol.replace(/:/, ''), this.host.replace(/:/, '~'), this.filePath)
  }

  static queryStringDistance(qsa: QueryString.ParsedUrlQuery, qsb: QueryString.ParsedUrlQuery): number {
    let match = 0, unmatch = 0, bNotInA = 0
    for (const a in qsa) {
      if (qsa[a] === qsb[a]) match++
      else unmatch++
    }
    for (const b in qsb) {
      if (qsa[b] === undefined) bNotInA++
    }

    return (unmatch + bNotInA) / (match + unmatch + bNotInA)
  }
}
