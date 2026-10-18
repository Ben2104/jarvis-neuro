import { expect, it } from 'vitest'
import { defaultAgentUrl, sendText, voiceSupported } from '.'

it('derives the WebSocket URL from the page origin', () => {
  expect(defaultAgentUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  expect(defaultAgentUrl({ protocol: 'https:', host: 'demo.example' })).toBe('wss://demo.example/ws')
})

it('does nothing before the agent is started', () => {
  expect(sendText('hello')).toBe(false)
  expect(voiceSupported()).toBe(false)
})
