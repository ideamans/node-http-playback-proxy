import { ProxyUrl } from './url'
import Levenshtein from 'js-levenshtein'
import Path from 'path'

export type HeadersType = { [prop: string]: any }

export class Resource {
  method: string = 'get'
  url: string = ''
  path: string = ''
  headers: HeadersType = {}
  ttfb: number = 0
  originResourceSize: number = 0
  originTransferSize: number = 0
  originContentEncoding: string = ''
  originDuration: number = 0
  timestamp: number = +new Date()

  constructor(values: Partial<Resource> = {}) {
    if (values.url !== undefined) this.setUrl(values.url)
    if (values.method !== undefined) this.method = values.method
    if (values.path !== undefined) this.path = values.path
    if (values.headers !== undefined) this.headers = values.headers
    if (values.ttfb !== undefined) this.ttfb = values.ttfb
    if (values.originTransferSize !== undefined) this.originTransferSize = values.originTransferSize
    if (values.originResourceSize !== undefined) this.originResourceSize = values.originResourceSize
    if (values.originContentEncoding !== undefined) this.originContentEncoding = values.originContentEncoding
    if (values.originDuration !== undefined) this.originDuration = values.originDuration
    if (values.timestamp !== undefined) this.timestamp = values.timestamp
  }

  get proxyUrl() {
    return new ProxyUrl(this.url)
  }

  setUrl(url: string) {
    this.url = url
    const u = new ProxyUrl(url)
    this.path = u.pathnize()
  }

  originBytesPerSecond(gap = 0) {
    if (this.originDuration <= 0) return NaN
    const seconds = (this.originDuration + gap) / 1000
    return this.originTransferSize / seconds
  }
}

export class ResourceTag {
  resource!: Resource
  host: string = ''
  path: string = ''
  extname: string = ''
  mimeType: string = ''
  lastMatching: number = 0

  constructor(res: Resource) {
    this.resource = res
    const url = res.proxyUrl
    this.host = url.host
    this.path = url.pathname + url.search || '/'

    const b = Path.basename(url.pathname)
    this.extname = Path.extname(b).toLowerCase()

    const ct = res.headers['content-type'] || ''
    this.mimeType = (Array.isArray(ct) ? ct.shift() : ct).split(';').shift().toLowerCase()
  }

  updateMatching(that: ResourceTag) {
    this.lastMatching = 0
    if (this.host !== that.host) return
    if (this.resource.method !== that.resource.method) return

    let matchLength = 0
    const minLength = Math.min(this.path.length, that.path.length)
    for (; matchLength < minLength && this.path[matchLength] === that.path[matchLength]; matchLength++) {}
    if (matchLength == 0) return

    const levenshtein = Levenshtein(this.path.slice(matchLength), that.path.slice(matchLength))
    this.lastMatching = matchLength - levenshtein
  }
}

export type ResourceIndex = { [method: string]: { [url: string]: Resource } }
export type ResourceGroup = { [group: string]: Resource[] }

export type ResourceFilterCallback = (tag: ResourceTag, res: Resource) => boolean

export class Spec {
  private resources: Resource[] = []
  resourcesIndex: ResourceIndex = {}
  resourcesTags: ResourceTag[] = []

  constructor(values: Partial<Spec> & { resources?: Array<Partial<Resource>> } = {}) {
    if (values.resources) this.resources = values.resources.map((r) => new Resource(r))
    this.reIndex()
  }

  toJson() {
    return JSON.stringify({
      resources: this.resources,
    })
  }

  get resourcesLength() {
    return this.resources.length
  }

  getResource(index: number) {
    return this.resources[index]
  }

  putResource(res: Resource) {
    const existed = this.lookupResource(res.method, res.url)
    if (!existed) {
      this.resources.push(res)
      this.indexResource(res)
    }
  }

  newResource(values: Partial<Resource> = {}) {
    const res = new Resource(values)
    this.putResource(res)
    return res
  }

  indexResource(res: Resource) {
    const index = (this.resourcesIndex[res.method] = this.resourcesIndex[res.method] || {})
    index[res.url] = res
    this.resourcesTags.push(new ResourceTag(res))
  }

  reIndex() {
    this.resourcesIndex = {}
    this.resourcesTags = []
    for (let res of this.resources) {
      this.indexResource(res)
    }
  }

  lookupResource(method: string, url: string) {
    const index = (this.resourcesIndex[method] = this.resourcesIndex[method] || {})
    return index[url]
  }

  findNearestResource(method: string, url: string) {
    const match = this.lookupResource(method, url)
    if (match) return match

    const res = new Resource({ method, url })
    const tag = new ResourceTag(res)
    this.resourcesTags.forEach((t) => t.updateMatching(tag))

    const sorted = this.resourcesTags.filter((t) => t.lastMatching > 0).sort((a, b) => b.lastMatching - a.lastMatching)
    const nearest = sorted.shift()
    if (nearest) return nearest.resource
  }

  filterResources(cb: ResourceFilterCallback, orderAsc = true) {
    return this.resourcesTags
      .filter((tag) => cb(tag, tag.resource))
      .map((tag) => tag.resource)

      .sort((a, b) => (orderAsc ? a.timestamp - b.timestamp : b.timestamp - a.timestamp))
  }
}
