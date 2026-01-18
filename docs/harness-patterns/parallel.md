# Parallel Execution Options

---

## Option A: Promise.all

Independent patterns, merge at end.

```typescript
parallel([pattern1, pattern2], merger)
// Uses: Promise.all(), allSettled(), race(), any()
```

**Use:** Search multiple sources, aggregate results.

---

## Option B: Streaming

Progressive results during execution.

```typescript
parallelStream(patterns, onChunk)
// Patterns emit chunks via ctx.emit()
```

**Use:** UI updates, first-result optimization.

---

## Option C: Event-Driven

Dynamic coordination via event bus.

```typescript
parallel(
  { searcher, critic, synthesizer },
  {
    on: {
      'searcher:RESULT': (d) => emit('critic:EVALUATE', d),
      'critic:APPROVED': (d) => emit('synthesizer:PRIME', d),
      'synthesizer:SUFFICIENT': () => controller.abort()
    }
  }
)
```

**Use:** Multi-agent negotiation, runtime coordination.

---

## Decision

- **Default:** Option A
- **Progressive UI:** Option B
- **Complex coordination:** Option C

Reserve EDA for legitimate complexity.
