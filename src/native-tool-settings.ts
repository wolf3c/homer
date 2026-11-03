export type NativeToolChoices = {
    shell: boolean;
    viewImage: boolean;
    shellSnapshot: boolean;
    skillSearch: boolean;
    search: 'disabled' | 'cached' | 'live';
};
const keys = { shell: 'shell_tool', viewImage: 'view_image', shellSnapshot: 'shell_snapshot', skillSearch: 'skill_search' } as const;
// Fixed 0.163 defaults for presentation only. No values from this function
// are passed as startup overrides; Codex owns loading and effective config.
export function nativeToolChoices(user: Record<string, any>): NativeToolChoices { return { ...Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, (user.features?.[key] ?? true) === true])), search: ['disabled', 'cached', 'live'].includes(user.web_search) ? user.web_search : 'cached' } as NativeToolChoices; }
export function validateNativeToolSettings(value: unknown): Record<string, unknown> {
    const v = value as Record<string, unknown>;
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 5 || Object.keys(v).some(k => ![...Object.keys(keys), 'search'].includes(k)) || Object.keys(keys).some(k => typeof v[k] !== 'boolean') || !['disabled', 'cached', 'live'].includes(String(v.search)))
        throw Error('capability_tool_settings_invalid');
    return { ...Object.fromEntries(Object.entries(keys).map(([name, key]) => ['features.' + key, v[name]])), web_search: v.search };
}
