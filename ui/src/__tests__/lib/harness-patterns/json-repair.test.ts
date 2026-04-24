/**
 * Tests for the lenient JSON repair utility.
 */

import { describe, it, expect } from 'vitest'
import { repairJson } from '../../../lib/harness-patterns/json-repair'

describe('repairJson', () => {
  describe('valid JSON passthrough', () => {
    it('should parse already-valid JSON', () => {
      expect(repairJson('{"query": "movies"}')).toEqual({ query: 'movies' })
    })

    it('should parse valid JSON with numbers', () => {
      expect(repairJson('{"max_results": 10}')).toEqual({ max_results: 10 })
    })

    it('should parse valid JSON with booleans and null', () => {
      expect(repairJson('{"a": true, "b": false, "c": null}')).toEqual({ a: true, b: false, c: null })
    })

    it('should parse valid nested JSON', () => {
      expect(repairJson('{"a": {"b": "c"}}')).toEqual({ a: { b: 'c' } })
    })

    it('should parse valid JSON with arrays', () => {
      expect(repairJson('{"items": [1, 2, 3]}')).toEqual({ items: [1, 2, 3] })
    })
  })

  describe('unquoted keys', () => {
    it('should fix unquoted single key', () => {
      expect(repairJson('{query: "movies"}')).toEqual({ query: 'movies' })
    })

    it('should fix multiple unquoted keys', () => {
      expect(repairJson('{query: "movies", max_results: 10}')).toEqual({ query: 'movies', max_results: 10 })
    })

    it('should fix keys with dollar signs', () => {
      expect(repairJson('{$limit: 5}')).toEqual({ $limit: 5 })
    })
  })

  describe('unquoted string values', () => {
    it('should fix unquoted single-word value', () => {
      expect(repairJson('{query: movies}')).toEqual({ query: 'movies' })
    })

    it('should fix unquoted multi-word value', () => {
      const result = repairJson('{query: BOZAR Brussels March 2026 programming}')
      expect(result).toEqual({ query: 'BOZAR Brussels March 2026 programming' })
    })

    it('should not quote numeric values', () => {
      expect(repairJson('{max_results: 10}')).toEqual({ max_results: 10 })
    })

    it('should not quote boolean values', () => {
      expect(repairJson('{verbose: true}')).toEqual({ verbose: true })
    })

    it('should not quote null values', () => {
      expect(repairJson('{value: null}')).toEqual({ value: null })
    })

    it('should handle mixed quoted and unquoted values', () => {
      expect(repairJson('{query: "movies", limit: 5}')).toEqual({ query: 'movies', limit: 5 })
    })
  })

  describe('trailing commas', () => {
    it('should remove trailing comma in object', () => {
      expect(repairJson('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 })
    })

    it('should remove trailing comma in array', () => {
      expect(repairJson('{"items": [1, 2,]}')).toEqual({ items: [1, 2] })
    })
  })

  describe('single-quoted strings', () => {
    it('should fix single-quoted keys and values', () => {
      expect(repairJson("{'query': 'movies'}")).toEqual({ query: 'movies' })
    })
  })

  describe('real-world LLM outputs', () => {
    it('should handle typical search tool args', () => {
      const result = repairJson('{query: movies showtimes Cinema Palace Brussels February 13th 2026}')
      expect(result).toEqual({
        query: 'movies showtimes Cinema Palace Brussels February 13th 2026'
      })
    })

    it('should handle fetch tool args', () => {
      expect(repairJson('{url: "https://example.com"}')).toEqual({ url: 'https://example.com' })
    })

    it('should handle neo4j query args', () => {
      expect(repairJson('{query: "MATCH (n) RETURN n LIMIT 10"}')).toEqual({
        query: 'MATCH (n) RETURN n LIMIT 10'
      })
    })
  })

  describe('error cases', () => {
    it('should throw on completely unparseable input', () => {
      expect(() => repairJson('not json at all')).toThrow()
    })

    it('should throw on empty string', () => {
      expect(() => repairJson('')).toThrow()
    })
  })
})
