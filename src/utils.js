/**
 * Gets a jittered value for randomization.
 * @param {number} base - The base value.
 * @param {number} jitterPct - The jitter percentage (0-1).
 * @returns {number} The jittered value.
 */
export function getJitteredValue(base, jitterPct) {
    const variance = (Math.random() - 0.5) * 2 * jitterPct;
    return base * (1 + variance);
}