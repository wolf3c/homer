// Business work may include engine shutdown or media decoding. Leave a minute
// for the local transport to return before the native MCP client expires.
export const INTERACTION_LIMITS=Object.freeze({connectMs:15000,businessMs:600000,nativeToolSeconds:660,responseBytes:2*1024*1024});
// Reserve room for JSON, base64 rounding and ordinary tool metadata.
export const TOOL_IMAGE_BYTES=Math.floor((INTERACTION_LIMITS.responseBytes-64*1024)*3/4);
