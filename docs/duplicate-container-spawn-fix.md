# Duplicate Container Spawn Analysis

## Problem

On 2026-03-31 around 17:51 Beijing time, two containers were running simultaneously for the same group (`feishu-oc_53f922a4ce864db1c7420c1a8e4c7ff4`):

| Container | Start Time | End Time | Duration | Exit Code |
|-----------|------------|----------|----------|-----------|
| Container 1 | 16:57 | 18:00 | 63 min | 0 |
| Container 2 | 17:31 | 18:07 | 36 min | 137 (TIMEOUT) |

**Overlap: ~29 minutes with two containers running for the same group**

## Root Cause Analysis

### Code Path

```
src/index.ts:processGroupMessages()
  → runAgent()
    → runContainerAgent()  [src/container-runner.ts]
      → onOutput callback (streaming results)
        → channel.sendMessage()  ← Can throw exception
```

### The Bug

In `src/container-runner.ts` line 416:
```javascript
outputChain = outputChain.then(() => onOutput(parsed));
```

If `onOutput` throws an exception (e.g., `channel.sendMessage` fails due to network/API error):
1. `outputChain` becomes a rejected Promise
2. When container closes (line 612-623):
   ```javascript
   outputChain.then(() => {
     resolve({...});  // Never executed!
   });
   ```
3. `runContainerAgent` Promise never resolves
4. `runForGroup` timeout (36 min) triggers
5. `state.active = false`, new container is created
6. **Old container still running** (SDK doesn't know about the error)

### Evidence (Missing)

No host-side logs were available to confirm:
- Whether `sendMessage` actually threw an exception
- Whether `outputChain` was rejected
- Whether `runForGroup` timeout triggered

The container logs showed:
- Container 1: Exit Code 0, no stderr (ran normally inside)
- Container 2: Exit Code 137 (TIMEOUT), `Had Streaming Output: true`

## Fix

Added try-catch in `src/index.ts` `onOutput` callback:

```javascript
const output = await runAgent(group, prompt, chatJid, async (result) => {
  try {
    // ... existing code
  } catch (err) {
    logger.error(
      { group: group.name, chatJid, err },
      'onOutput callback failed (sendMessage or other error)',
    );
    // Don't rethrow — let outputChain continue normally so container can exit
  }
});
```

### Why This Approach

1. **Preserves error context**: Logs include group name, chatJid, and full error details
2. **Lets container exit normally**: `outputChain` won't reject
3. **Prevents duplicate containers**: No timeout trigger → no new container spawn

## Recommendations

1. Enable debug logging to capture future incidents:
   ```bash
   LOG_LEVEL=debug npm run dev
   ```

2. Monitor for the new error log pattern:
   ```
   ERROR: onOutput callback failed (sendMessage or other error)
   ```

3. Consider adding alerting when this error occurs frequently (may indicate channel issues)

## Related Files

- `src/index.ts:357-393` - `processGroupMessages` function
- `src/container-runner.ts:416` - `outputChain` Promise chain
- `src/group-queue.ts:328` - `runForGroup` timeout (CONTAINER_TIMEOUT + 60000)