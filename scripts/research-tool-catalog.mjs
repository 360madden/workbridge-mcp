// Pure release-catalog compatibility check: historical Workbridge releases can
// lack research tools, but a new research-enabled release must expose all four.
export const RESEARCH_TOOL_NAMES = Object.freeze([
  'research_plan',
  'research_run',
  'research_status',
  'research_verify',
]);

export function checkResearchToolCatalog(tools, runtimeVersion) {
  if (!Array.isArray(tools)) throw new Error('Research release tool catalog must be an array.');
  const selected = tools.filter((tool) => RESEARCH_TOOL_NAMES.includes(tool?.name));
  if (selected.length === 0) return { count: 0, sealedRuntimeRequired: false };
  if (runtimeVersion !== '0.16.5-dev') {
    throw new Error('Research tools appeared on an unsupported rollback runtime version.');
  }
  if (
    selected.length !== RESEARCH_TOOL_NAMES.length ||
    new Set(selected.map((tool) => tool.name)).size !== RESEARCH_TOOL_NAMES.length
  ) {
    throw new Error('Research MCP tool catalog is partial or contains repeated names.');
  }
  for (const name of RESEARCH_TOOL_NAMES) {
    const tool = selected.find((entry) => entry.name === name);
    if (!tool || tool.annotations?.readOnlyHint !== (name === 'research_status')) {
      throw new Error('Missing or invalid research MCP tool annotations: ' + name);
    }
    if (tool.annotations?.openWorldHint !== false || tool.annotations?.destructiveHint !== false) {
      throw new Error('Research MCP tool has unsupported effect annotations: ' + name);
    }
    if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
      throw new Error('Research MCP tool has no typed input schema: ' + name);
    }
  }
  return { count: RESEARCH_TOOL_NAMES.length, sealedRuntimeRequired: true };
}
