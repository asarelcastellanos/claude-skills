// Session state of the model-policy mod. The shape is read through $.state.

export type ModelPolicyDay = {
	families: Record<string, { tokens: number; cache: number }>
	types: Record<string, { spawns: number; tokens: number; model: string }>
}

export type ModelPolicyUsage = Record<string, { tokens: number; cache: number }>

/** A model the start-of-session question offers. Also the alias /model takes. */
export type ModelPolicyPick = 'opus' | 'sonnet' | 'haiku'

declare module 'claude-code' {
	interface PluginState {
		'model-policy': {
			/** False after `/model-policy off`. Unset means on. */
			enabled: boolean
			/** Per model family: input + output tokens, and cache read + creation tokens. */
			usage: ModelPolicyUsage
			/** This session's spawned agents: agent id to agent type, for the per-type day log. */
			agents: Record<string, string>
			/** This session's tally by local date, flushed to $.store as day-<date>-<sessionId>. */
			days: Record<string, ModelPolicyDay>
			/** True once the start-of-session model question was shown, so a reload or a second start never asks again. */
			asked: boolean
		}
	}
}
