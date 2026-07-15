export const executableAction = (node: any): string | undefined =>
	typeof node?.interaction?.actionBindingId === "string" && node.interaction.actionBindingId.length > 0
		? node.interaction.actionBindingId
		: undefined

export const declaredAction = (node: any): string | undefined => executableAction(node)
	?? node?.attributes?.action_binding_id
	?? node?.attributes?.pulpHostAction

export const uniqueActions = (nodes: any[], project: (node: any) => string | undefined): string[] =>
	[...new Set(nodes.map(project).filter((item): item is string => !!item))].sort()

export const missingRequiredExecutableActions = (
	nodes: any[],
	requiredActions: string[],
	nativeActions: ReadonlySet<string>,
): string[] => {
	const executable = new Set(uniqueActions(nodes, executableAction))
	return requiredActions.filter((id) => !executable.has(id) && !nativeActions.has(id)).sort()
}

export const declaredButUnattachedActions = (nodes: any[]): Array<{ node: any; action: string }> =>
	nodes.flatMap((node) => {
		const declared = declaredAction(node)
		return declared && !executableAction(node) ? [{ node, action: declared }] : []
	})
