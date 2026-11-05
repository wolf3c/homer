import {
  constants,
  mkdirSync,
  fstatSync,
  realpathSync,
  openSync,
  readFileSync,
  closeSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve, relative, join, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import {detectMedia,imageDimensions,MEDIA_POLICY} from './media-policy.js';
import {isUtf8} from 'node:buffer';
export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel !== "" &&
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`)
  );
}
export function canonicalDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const actual = realpathSync(path);
  if (resolve(path) !== actual) throw new Error("symlink_directory_denied");
  return actual;
}
export class Files {
  readonly materials: string;
  readonly outputs: string;
  constructor(readonly workspace: string) {
    canonicalDir(workspace);
    this.materials = canonicalDir(join(workspace, "materials"));
    this.outputs = canonicalDir(join(workspace, "outputs"));
  }
  private relativePath(root: string, path: string) {
    if (
      typeof path !== "string" ||
      !path ||
      path.includes("\0") ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((x) => x === ".." || x === ".")
    )
      throw new Error("path_denied");
    const full = resolve(root, path);
    if (!inside(root, full)) throw new Error("path_denied");
    return full;
  }
  private checkedFile(root: string, path: string, maxBytes = 128 * 1024,binary=false) {
    let actual: string;
    try {
      actual = realpathSync(path);
    } catch {
      throw new Error("material_missing");
    }
    if (!inside(root, actual) || actual !== path)
      throw new Error("symlink_denied");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes)
        throw new Error("file_type_or_size_denied");
      return binary?readFileSync(fd):readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  }
  readMaterial(path: string) {
    return this.checkedFile(
      this.materials,
      this.relativePath(this.materials, path),
    ) as string;
  }
  listMaterials() {
    return readdirSync(this.materials, { withFileTypes: true })
      .filter((x) => x.isFile() && x.name.endsWith(".md"))
      .map((x) => x.name);
  }
  prepareRun(taskId: string, runId: string) {
    if (!/^task-[\w-]+$/.test(taskId) || !/^run-[\w-]+$/.test(runId))
      throw new Error("id_denied");
    return canonicalDir(
      join(canonicalDir(join(this.outputs, taskId)), runId),
    );
  }
  writeMarkdown(dir: string, filename: string, content: string) {
    if (realpathSync(dir) !== dir || !inside(this.outputs, dir))
      throw new Error("path_denied");
    if (
      typeof filename !== "string" ||
      !filename.match(/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,99}\.md$/u)
    )
      throw new Error("filename_denied");
    if (
      typeof content !== "string" ||
      !content.trim() ||
      Buffer.byteLength(content) > 128 * 1024
    )
      throw new Error("empty_or_large_artifact");
    const full = this.relativePath(dir, filename);
    let fd: number;
    try {
      fd = openSync(
        full,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      throw new Error("artifact_exists");
    }
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    return full;
  }
  verify(dir: string, path: string) {
    if (
      !inside(this.outputs, dir) ||
      realpathSync(dir) !== dir ||
      !inside(dir, path)
    )
      throw new Error("artifact_path_denied");
    const data=this.checkedFile(dir,path,MEDIA_POLICY.fileBytes,true) as Buffer;
    if(!data.length)throw Error('artifact_empty');
    const mime=detectMedia(data),text=/\.(md|txt|csv|json)$/i.test(path)&&isUtf8(data);
    if(path.endsWith('.md')&&data.length>128*1024)throw Error('file_type_or_size_denied');
    const content=text?data.toString('utf8'):JSON.stringify({mime,size:data.length,dimensions:imageDimensions(data,mime),notice:'二进制文件：此清单不代表已理解全部内容；使用正式成果检查工具查看实际提取内容或图片。'});
    if (!content.trim()) throw new Error("artifact_empty");
    return {
      path,
      content,
      bytes: data.length,mime:text?(path.endsWith('.md')?'text/markdown':'text/plain'):mime,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }
  resultBytes(dir:string,path:string){
    const file=this.verify(dir,path),data=this.checkedFile(dir,path,MEDIA_POLICY.fileBytes,true) as Buffer;
    if(createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('artifact_changed');
    return {...file,data};
  }
  writeBinary(dir:string,filename:string,bytes:Buffer){
    if(realpathSync(dir)!==dir||!inside(this.outputs,dir)||!/^([\p{L}\p{N}_-])[\p{L}\p{N}_.-]{0,110}$/u.test(filename))throw Error('artifact_path_denied');
    if(!bytes.length||bytes.length>MEDIA_POLICY.fileBytes)throw Error('file_type_or_size_denied');
    const path=this.relativePath(dir,filename),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{writeFileSync(fd,bytes);}finally{closeSync(fd);}return path;
  }
}
