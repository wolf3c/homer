import {
  constants,
  mkdirSync,
  fstatSync,
  realpathSync,
  openSync,
  readFileSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative, join, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import {MEDIA_POLICY} from './media-policy.js';
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
  readonly outputs: string;
  constructor(readonly workspace: string) {
    canonicalDir(workspace);
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
  prepareRun(taskId: string, runId: string) {
    if (!/^task-[\w-]+$/.test(taskId) || !/^run-[\w-]+$/.test(runId))
      throw new Error("id_denied");
    return canonicalDir(
      join(canonicalDir(join(this.outputs, taskId)), runId),
    );
  }
  verify(dir: string, path: string) {
    if (!inside(this.outputs, dir) || realpathSync(dir) !== dir || !inside(dir, path) || realpathSync(path)!==path)
      throw Error("artifact_path_denied");
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const stat=fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>MEDIA_POLICY.fileBytes)throw Error('file_type_or_size_denied');
      const data=readFileSync(fd);
      if(data.length!==stat.size)throw Error('artifact_changed');
      return {path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
    }finally{closeSync(fd);}
  }
  writeBinary(dir:string,filename:string,bytes:Buffer){
    if(realpathSync(dir)!==dir||!inside(this.outputs,dir)||!/^([\p{L}\p{N}_-])[\p{L}\p{N}_.-]{0,110}$/u.test(filename))throw Error('artifact_path_denied');
    if(!bytes.length||bytes.length>MEDIA_POLICY.fileBytes)throw Error('file_type_or_size_denied');
    const path=this.relativePath(dir,filename),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{writeFileSync(fd,bytes);}finally{closeSync(fd);}return path;
  }
}
