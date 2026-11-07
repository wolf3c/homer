// Exact snapshot references used by the isolated acceptance programs.
export const messageFilesForRun=`SELECT m.id AS messageId,m.text,a.id AS assetId,a.hash AS sha256
  FROM runs r JOIN conversation_messages m ON m.taskId=r.taskId AND m.taskVersion=r.version
  JOIN conversation_attachments c ON c.messageId=m.id JOIN json_each(c.refsJson) ref
  JOIN media_assets a ON a.id=json_extract(ref.value,'$.assetId') AND a.revision=json_extract(ref.value,'$.revision')
  WHERE r.id=? AND m.role='assistant' AND m.audience='user' AND m.status='completed' AND m.revokedAt IS NULL AND a.state='ready'`;
