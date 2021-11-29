import { URL } from "url";
import Path from "path";
import QueryString from "querystring";
import Sha1 from "sha1";

export class ProxyUrl extends URL {
  static directoryIndex = "index.html";
  static maxFilenameLength = 196;
  static fileUniqHashLength = 8;

  get filePath(): string {
    let path = this.pathname;
    if (path.endsWith("/")) {
      path += ProxyUrl.directoryIndex;
    } else {
      const ext = Path.extname(path);
      if (ext === "") {
        path = Path.join(path, ProxyUrl.directoryIndex);
      }
    }

    const dir = Path.dirname(path);
    const ext = Path.extname(path);
    const base = Path.basename(path, ext);

    let filename = base;
    if (this.search !== "") {
      filename = `${filename}~${this.search.slice(1)}`;
    }
    if (filename.length > ProxyUrl.maxFilenameLength) {
      const seed = filename.slice(ProxyUrl.maxFilenameLength);
      filename =
        filename.slice(0, ProxyUrl.maxFilenameLength) +
        "_" +
        Sha1(seed).slice(0, ProxyUrl.fileUniqHashLength);
    }

    filename += ext;

    return Path.join(dir, filename);
  }

  pathnize(method = "get"): string {
    method = method.toLowerCase();
    return Path.join(
      method,
      this.protocol.replace(/:/, ""),
      this.host.replace(/:/, "~"),
      this.filePath
    );
  }

  static queryStringDistance(
    qsa: QueryString.ParsedUrlQuery,
    qsb: QueryString.ParsedUrlQuery
  ): number {
    let match = 0,
      unmatch = 0,
      bNotInA = 0;
    for (const a in qsa) {
      if (qsa[a] === qsb[a]) match++;
      else unmatch++;
    }
    for (const b in qsb) {
      if (qsa[b] === undefined) bNotInA++;
    }

    return (unmatch + bNotInA) / (match + unmatch + bNotInA);
  }
}
