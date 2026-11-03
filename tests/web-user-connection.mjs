// Synthetic callers access only their own fixture gateway. No credentials.
export const syntheticUserFetch=()=>globalThis.fetch;
