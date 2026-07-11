/** Host-neutral Palot product state shared by Electron and Burl consumers. */
export interface PalotProjectRef {
	id: string
	directory: string
}

export interface PalotSessionRef {
	id: string
	projectId: string
	title: string
}
