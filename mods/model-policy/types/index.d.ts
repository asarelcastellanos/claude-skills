// Session state of the model-policy mod. The shape is read through $.state.

export type ModelPolicyUsage = Record<string, { tokens: number; cache: number }>

declare module 'claude-code' {
	interface PluginState {
		'model-policy': {
			/** False after `/model-policy off`. Unset means on. */
			enabled: boolean
			/** Per model family: input + output tokens, and cache read + creation tokens. */
			usage: ModelPolicyUsage
		}
	}
}
